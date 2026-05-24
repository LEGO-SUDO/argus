import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConversationsModule } from './conversations/conversations.module';
import { ChatModule } from './chat/chat.module';
import { ProvidersModule } from './providers/providers.module';
import { PrismaService } from './common/prisma.service';

// Phase A wiring:
//   - AuthModule          (HLD D5: signup/login/logout + session guard)
//   - ConversationsModule (HLD: REST CRUD, user-scoped repository)
//   - ChatModule          (HLD D2: WS Gateway + chat service)
//   - ProvidersModule     (chat-context-and-ux-polish: GET /providers picker catalog)
//   - PrismaService       (re-exported here so main.ts can resolve it for seed)
@Module({
  imports: [AuthModule, ConversationsModule, ChatModule, ProvidersModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
