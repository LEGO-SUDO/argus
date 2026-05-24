// Workers process bootstrap.
//
// Boots a NestJS HTTP listener (for /healthz) + brings up the
// ProjectionModule (kafkajs consumer + Prisma client). Sentry is initialized
// FIRST so any boot-time error is captured.
//
// Graceful shutdown: SIGINT / SIGTERM closes the Nest app which fires
// OnModuleDestroy → consumer.disconnect() + prisma.$disconnect() so kafka
// offsets are flushed and DB connections returned.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { initSentry, captureProjectionError } from './observability/sentry';

async function bootstrap(): Promise<void> {
  initSentry();
  const logger = new Logger('bootstrap');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
  });
  const port = Number(process.env.PORT ?? 3002);
  await app.listen(port, '0.0.0.0');
  logger.log(`workers listening on :${port} (healthz)`);

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`received ${signal} — shutting down`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      captureProjectionError({
        err,
        layer: 'consumer',
        recoverable: 'no',
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
  captureProjectionError({
    err,
    layer: 'consumer',
    recoverable: 'no',
    extra: { stage: 'bootstrap' },
  });
  process.exit(1);
});
