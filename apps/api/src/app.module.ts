import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConversationsModule } from './conversations/conversations.module';
import { ChatModule } from './chat/chat.module';
import { ProvidersModule } from './providers/providers.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { AutoModule } from './auto/auto.module';
import { ReplayModule } from './replay/replay.module';
import { ConsoleModule } from './console/console.module';
import { LiveEventsModule } from './console/live-events.module';
import { HeartbeatModule } from './heartbeat/heartbeat.module';
import { JanitorModule } from './janitor/janitor.module';
import { PrismaService } from './common/prisma.service';

// Phase A wiring:
//   - AuthModule          (HLD D5: signup/login/logout + session guard)
//   - ConversationsModule (HLD: REST CRUD, user-scoped repository)
//   - ChatModule          (HLD D2: WS Gateway + chat service)
//   - ProvidersModule     (chat-context-and-ux-polish: GET /providers picker catalog)
//   - PrismaService       (re-exported here so main.ts can resolve it for seed)
// Phase B wiring (control plane):
//   - OrchestratorModule  (@Global per-user in-flight registry)
//   - AutoModule          (Auto router: classifier / keyword heuristic)
//   - ReplayModule        (replay service)
//   - ConsoleModule       (Traces/Cost/Replay REST + SSE + providers)
//   - LiveEventsModule    (SSE hub + live-events Kafka consumer)
//   - HeartbeatModule     (heartbeat span scheduler)
//   - JanitorModule       (stranded-stream sweeper)
@Module({
  imports: [
    AuthModule,
    ConversationsModule,
    ChatModule,
    ProvidersModule,
    OrchestratorModule,
    AutoModule,
    ReplayModule,
    ConsoleModule,
    LiveEventsModule,
    HeartbeatModule,
    JanitorModule,
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
