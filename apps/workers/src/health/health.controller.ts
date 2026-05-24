// GET /healthz — used by Docker Compose healthcheck. Returns 200 when:
//   - the kafkajs projection consumer reports isRunning=true (or is
//     intentionally disabled via WORKERS_DISABLE_CONSUMER=true for tests)
//   - the Prisma client can complete `SELECT 1`
//
// 503 otherwise. Body is JSON so the failure mode is debuggable from
// `curl -s | jq`.
import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { prisma } from '@argus/db';
import { ProjectionConsumer } from '../projection/projection.consumer';

@Controller()
export class HealthController {
  constructor(private readonly consumer: ProjectionConsumer) {}

  @Get('healthz')
  async healthz(): Promise<{ status: 'ok'; consumer: boolean; db: boolean }> {
    const consumerOk =
      process.env.WORKERS_DISABLE_CONSUMER === 'true' ? true : this.consumer.isRunning();

    let dbOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    if (!consumerOk || !dbOk) {
      throw new HttpException(
        { status: 'unhealthy', consumer: consumerOk, db: dbOk },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok', consumer: consumerOk, db: dbOk };
  }
}
