// API process bootstrap.
//
// Order (Tasks 18 + 56):
//   1. initSentry (so any boot-time error is captured)
//   2. Build Nest app
//   3. cookie-parser middleware (REST + read by SessionGuard)
//   4. WS adapter (@nestjs/platform-ws — raw WebSocket, not socket.io)
//   5. Fail-fast db ping (Task 56) — prisma.$queryRaw `SELECT 1`
//   6. seedDemoUser (Task 17)
//   7. app.listen
//
// Graceful shutdown: SIGINT / SIGTERM close the Nest app which fires
// PrismaService.onModuleDestroy → $disconnect.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PrismaService } from './common/prisma.service';
import { seedDemoUser } from './bootstrap/seed';
import { captureApiError, initSentry } from './observability/sentry';

async function bootstrap(): Promise<void> {
  initSentry();
  const logger = new Logger('bootstrap');

  // Fail-fast env validation: SESSION_SECRET is required for HMAC-based
  // session token hashing (session.repository). Without it the first /auth
  // request would throw a 500 — surface the misconfiguration on boot instead.
  // Length ≥ 32 in production keeps brute-force resistance honest; dev mode
  // accepts any non-empty value so a missing .env doesn't block local work.
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length === 0) {
    logger.error('SESSION_SECRET env var is required for session token hashing — refusing to boot');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && sessionSecret.length < 32) {
    logger.error(
      'SESSION_SECRET must be at least 32 chars in production — refusing to boot with a short key',
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.use(cookieParser());
  app.useWebSocketAdapter(new WsAdapter(app));

  // Task 56 — fail-fast db ping so compose boot-order regressions surface as a
  // clear error rather than a cryptic Prisma stack inside seedDemoUser.
  const prismaService = app.get(PrismaService);
  try {
    await prismaService.db.$queryRaw`SELECT 1`;
  } catch (err) {
    captureApiError({
      err,
      feature: 'bootstrap',
      layer: 'service',
      extra: { stage: 'db-ping' },
    });
    logger.error('database not reachable on boot — exiting');
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  }

  // Task 17 + 18 — idempotent demo-user seed.
  try {
    const seedResult = await seedDemoUser(prismaService.db);
    logger.log(
      `demo user ${seedResult.created ? 'created' : 'present'} — email=${seedResult.email}`,
    );
  } catch (err) {
    captureApiError({
      err,
      feature: 'bootstrap',
      layer: 'service',
      extra: { stage: 'seed' },
    });
    logger.error('demo seed failed — exiting');
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  logger.log(`api listening on :${port}`);

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`received ${signal} — shutting down`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      captureApiError({
        err,
        feature: 'bootstrap',
        layer: 'service',
        extra: { stage: 'shutdown' },
      });
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('bootstrap failure', err);
  captureApiError({
    err,
    feature: 'bootstrap',
    layer: 'service',
    extra: { stage: 'bootstrap' },
  });
  process.exit(1);
});
