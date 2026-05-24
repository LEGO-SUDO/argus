import { Module } from '@nestjs/common';
import { ProjectionModule } from './projection/projection.module';
import { HealthController } from './health/health.controller';

// Phase A wiring:
//   - ProjectionModule (HLD D1: Redpanda consumer enriching inferences by message_id)
//   - HealthController (compose healthcheck for `workers` service)
// Phase B will add CostRollupModule + ReplayModule (BullMQ-backed).
@Module({
  imports: [ProjectionModule],
  controllers: [HealthController],
})
export class AppModule {}
