// ProjectionModule — wires the projection consumer + service into the Nest
// application context.
//
// Provides:
//   - PrismaClient (singleton from @argus/db) under its own token
//   - ProjectionService (orchestrator)
//   - ProjectionConsumer (kafkajs lifecycle, started via OnModuleInit)
import { Module } from '@nestjs/common';
import { prisma } from '@argus/db';
import { ProjectionConsumer } from './projection.consumer';
import { ProjectionService } from './projection.service';

export const PRISMA = Symbol('PRISMA_CLIENT');

@Module({
  providers: [
    { provide: PRISMA, useValue: prisma },
    {
      provide: ProjectionService,
      useFactory: () => new ProjectionService(prisma),
    },
    ProjectionConsumer,
  ],
  exports: [ProjectionService, ProjectionConsumer],
})
export class ProjectionModule {}
