// AuthModule wires the controller + service + repository together and exports
// AuthService so the chat gateway (WS handshake) and SessionGuard (REST) can
// inject it.
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionRepository } from './session.repository';
import { SessionGuard } from './session.guard';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionRepository, SessionGuard, PrismaService],
  exports: [AuthService, SessionGuard, PrismaService],
})
export class AuthModule {}
