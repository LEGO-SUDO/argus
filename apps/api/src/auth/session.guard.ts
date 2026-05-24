// SessionGuard — Nest guard reading the session cookie off the incoming
// request and attaching { id: userId } to req.user.
//
// Task 13: throws UnauthorizedException on missing/invalid cookie, attaches
// userId on hit. Mounted via @UseGuards(SessionGuard) on every authenticated
// REST controller method.
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { SESSION_COOKIE_NAME } from '../common/session-cookie';

export interface AuthenticatedUser {
  id: string;
}

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest & { cookies?: Record<string, string> }>();
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException('Missing session cookie');
    }
    const userId = await this.auth.findUserBySessionToken(token);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    req.user = { id: userId };
    return true;
  }
}
