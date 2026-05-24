import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { SeqCounterRegistry } from './seq-counter';
import { ContextMeterService } from './context-meter.service';
import { PrismaService } from '../common/prisma.service';
import { SdkCatalogProvider } from '../common/sdk-catalog.provider';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [AuthModule, ConversationsModule],
  providers: [
    ChatService,
    ChatGateway,
    SeqCounterRegistry,
    ContextMeterService,
    PrismaService,
    // chat-context-and-ux-polish LLD Task 55 — Nest provider for the SDK
    // catalog accessor. Tests override via the same `SDK_CATALOG` token.
    SdkCatalogProvider,
  ],
  // Export ContextMeterService so the conversations controller (LLD Task 81)
  // can consume it without importing chat-internal collaborators.
  exports: [ChatService, ContextMeterService],
})
export class ChatModule {}
