import { Module, forwardRef } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsRepository } from './conversations.repository';
import { MessagesRepository } from './messages.repository';
import { PrismaService } from '../common/prisma.service';
import { SdkCatalogProvider } from '../common/sdk-catalog.provider';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';

// chat-context-and-ux-polish LLD Task 81 — ConversationsController consumes
// ContextMeterService. The natural place to import that service is the chat
// module; ChatModule in turn imports ConversationsModule (for the gateway's
// conversations repository). The forwardRef breaks the cycle: ChatModule
// already imports ConversationsModule eagerly; we forwardRef ChatModule here
// so Nest resolves the order at compile time.
@Module({
  imports: [AuthModule, forwardRef(() => ChatModule)],
  controllers: [ConversationsController],
  providers: [
    ConversationsRepository,
    MessagesRepository,
    PrismaService,
    // SDK catalog for the PATCH-validate-pin + GET-messages fallback resolver
    // (LLD Tasks 79/89). Same provider symbol the chat module registers; Nest
    // resolves to a single instance per process.
    SdkCatalogProvider,
  ],
  exports: [ConversationsRepository, MessagesRepository],
})
export class ConversationsModule {}
