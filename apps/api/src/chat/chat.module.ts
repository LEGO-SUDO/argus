import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { SeqCounterRegistry } from './seq-counter';
import { PrismaService } from '../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AutoModule } from '../auto/auto.module';
import { sdkChatProvider } from '../common/sdk';

// OrchestratorRegistry is provided by the @Global OrchestratorModule (imported
// once in AppModule), so the gateway resolves it without an explicit import.
@Module({
  imports: [AuthModule, ConversationsModule, AutoModule],
  providers: [ChatService, ChatGateway, SeqCounterRegistry, PrismaService, sdkChatProvider],
  exports: [ChatService],
})
export class ChatModule {}
