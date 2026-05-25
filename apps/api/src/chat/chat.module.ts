import { Module, forwardRef } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { SeqCounterRegistry } from './seq-counter';
import { ContextMeterService } from './context-meter.service';
import { PrismaService } from '../common/prisma.service';
import { SdkCatalogProvider } from '../common/sdk-catalog.provider';
import { SdkChatStreamProvider } from '../common/sdk-chat.provider';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AutoModule } from '../auto/auto.module';

// OrchestratorRegistry is provided by the @Global OrchestratorModule (imported
// once in AppModule), so the gateway resolves it without an explicit import.
@Module({
  // forwardRef breaks the chat ↔ conversations cycle: the gateway needs
  // ConversationsRepository; the conversations controller needs
  // ContextMeterService (which chat owns). See conversations.module.ts for
  // the matching forwardRef on the other side.
  // AutoModule (Phase B) exports AutoRouterService, which the gateway injects
  // to resolve `auto` provider selections into a classifier-driven decision.
  imports: [AuthModule, forwardRef(() => ConversationsModule), AutoModule],
  providers: [
    ChatService,
    ChatGateway,
    SeqCounterRegistry,
    ContextMeterService,
    PrismaService,
    // chat-context-and-ux-polish LLD Task 55 — Nest provider for the SDK
    // catalog accessor. Tests override via the same `SDK_CATALOG` token.
    SdkCatalogProvider,
    // chat-context-and-ux-polish LLD Task 60 — Nest provider for the SDK
    // `chat.stream` entry point so tests can capture the request shape.
    SdkChatStreamProvider,
  ],
  // Export ContextMeterService so the conversations controller (LLD Task 81)
  // can consume it without importing chat-internal collaborators.
  exports: [ChatService, ContextMeterService],
})
export class ChatModule {}
