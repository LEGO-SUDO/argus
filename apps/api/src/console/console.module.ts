// ConsoleModule — wires the `/console/*` REST + SSE surfaces.
//
// Controllers: ConsoleController (Traces/Cost/Replay/Samples/Clear/badge),
// LiveController (SSE), ProvidersController (availability). Pulls ChatService
// (samples/clear), ReplayService (replay run), and SseHub (SSE fan-out) from
// their owning modules; the OrchestratorRegistry comes from the @Global
// OrchestratorModule.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { ReplayModule } from '../replay/replay.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { LiveEventsModule } from './live-events.module';
import { PrismaService } from '../common/prisma.service';
import { Clock } from '../common/clock';
import { apiConfigProvider } from '../common/config';
import { sdkChatProvider } from '../common/sdk';
import { SeqCounterRegistry } from '../chat/seq-counter';
import { ConsoleController } from './console.controller';
import { LiveController } from './live.controller';
import { ProvidersController } from './providers.controller';
import { Aggregates } from './aggregates';
import { TracesRepository } from './traces.repository';
import { CostRepository } from './cost.repository';
import { ReplayRepository } from './replay.repository';
import { SamplesService } from './samples.service';
import { ClearService } from './clear.service';
import { LiveBadgeService } from './live-badge.service';

@Module({
  imports: [AuthModule, ChatModule, ReplayModule, OrchestratorModule, LiveEventsModule],
  controllers: [ConsoleController, LiveController, ProvidersController],
  providers: [
    Aggregates,
    TracesRepository,
    CostRepository,
    ReplayRepository,
    SamplesService,
    ClearService,
    LiveBadgeService,
    PrismaService,
    Clock,
    SeqCounterRegistry,
    apiConfigProvider,
    sdkChatProvider,
  ],
})
export class ConsoleModule {}
