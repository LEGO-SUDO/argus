// JanitorModule — provides the stranded-stream janitor + its scheduler.
import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Clock } from '../common/clock';
import { apiConfigProvider } from '../common/config';
import { JanitorService } from './janitor.service';
import { JanitorScheduler } from './scheduler';

@Module({
  providers: [JanitorService, JanitorScheduler, PrismaService, Clock, apiConfigProvider],
  exports: [JanitorService, JanitorScheduler],
})
export class JanitorModule {}
