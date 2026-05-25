// ReplayModule — wires the replay service.
//
// Imports ChatModule for ChatService (the turn-starter) and provides the
// SDK chat surface + SeqCounterRegistry the orchestrator needs. The
// OrchestratorRegistry comes from the @Global OrchestratorModule.
import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SeqCounterRegistry } from '../chat/seq-counter';
import { ChatModule } from '../chat/chat.module';
import { sdkChatProvider } from '../common/sdk';
import { ReplayService } from './replay.service';

@Module({
  imports: [ChatModule],
  providers: [ReplayService, PrismaService, SeqCounterRegistry, sdkChatProvider],
  exports: [ReplayService],
})
export class ReplayModule {}
