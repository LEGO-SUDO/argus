import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsRepository } from './conversations.repository';
import { MessagesRepository } from './messages.repository';
import { PrismaService } from '../common/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // SessionGuard needs AuthService
  controllers: [ConversationsController],
  providers: [ConversationsRepository, MessagesRepository, PrismaService],
  exports: [ConversationsRepository, MessagesRepository],
})
export class ConversationsModule {}
