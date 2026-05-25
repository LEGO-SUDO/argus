// ProjectionModule — wires the projection consumer + service into the Nest
// application context.
//
// Provides:
//   - PrismaClient (singleton from @argus/db) under its own token
//   - LiveEventsPublisher (kafkajs producer for the post-commit live tick;
//     Kafka client built from env REDPANDA_BROKERS so tests can inject a mock)
//   - ProjectionService (orchestrator)
//   - ProjectionConsumer (kafkajs lifecycle, started via OnModuleInit)
import { Module } from '@nestjs/common';
import { Kafka, logLevel as kafkaLogLevel } from 'kafkajs';
import { prisma } from '@argus/db';
import { ProjectionConsumer } from './projection.consumer';
import { ProjectionService } from './projection.service';
import { LiveEventsPublisher } from './live-events-publisher';

export const PRISMA = Symbol('PRISMA_CLIENT');

function createLiveEventsPublisher(): LiveEventsPublisher {
  const brokersEnv = process.env.REDPANDA_BROKERS ?? 'redpanda:9092';
  const brokers = brokersEnv.split(',').map((b) => b.trim()).filter(Boolean);
  const kafka = new Kafka({
    clientId: 'argus-workers-live-events',
    brokers,
    logLevel: kafkaLogLevel.WARN,
  });
  return new LiveEventsPublisher(kafka);
}

@Module({
  providers: [
    { provide: PRISMA, useValue: prisma },
    { provide: LiveEventsPublisher, useFactory: createLiveEventsPublisher },
    {
      provide: ProjectionService,
      useFactory: (publisher: LiveEventsPublisher) => new ProjectionService(prisma, publisher),
      inject: [LiveEventsPublisher],
    },
    ProjectionConsumer,
  ],
  exports: [ProjectionService, ProjectionConsumer],
})
export class ProjectionModule {}
