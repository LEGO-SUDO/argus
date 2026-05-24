import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { SeqCounterRegistry } from './seq-counter';
import { PrismaService } from '../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [AuthModule, ConversationsModule],
  providers: [ChatService, ChatGateway, SeqCounterRegistry, PrismaService],
  exports: [ChatService],
})
export class ChatModule {}
