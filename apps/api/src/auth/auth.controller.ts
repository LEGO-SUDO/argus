// REST controller for /auth/{signup,login,logout,session}.
//
// Body validation via zod (DTO files in ./dto). On success the controller
// writes the session cookie via Set-Cookie and returns the AuthResponse
// envelope. Errors:
//   - zod parse failure  -> 400 with ErrorResponse { code: 'invalid_request' }
//   - DuplicateEmailError -> 409 with code: 'email_taken'
//   - InvalidCredentialsError -> 401 with code: 'invalid_credentials'
//
// GET /auth/session: gated by SessionGuard. Returns { userId, email } when
// the cookie validates and the user still exists; clears the cookie + 401
// when the user has been deleted out from under a valid session.
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SignupRequestSchema } from './dto/signup.dto';
import { LoginRequestSchema } from './dto/login.dto';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  SESSION_COOKIE_NAME,
} from '../common/session-cookie';
import { DuplicateEmailError, InvalidCredentialsError } from './errors';
import { SessionGuard, type AuthenticatedRequest } from './session.guard';
import { captureApiError } from '../observability/sentry';
import type { AuthResponse, SessionResponse } from '@argus/contracts';

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    const parsed = SignupRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      });
    }
    try {
      const { userId, sessionToken } = await this.auth.signup(parsed.data.email, parsed.data.password);
      res.setHeader('Set-Cookie', buildSessionCookie(sessionToken, { secure: isProd() }));
      return { userId };
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        throw new ConflictException({
          error: { code: 'email_taken', message: 'A user with this email already exists' },
        });
      }
      throw err;
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      });
    }
    try {
      const { userId, sessionToken } = await this.auth.login(parsed.data.email, parsed.data.password);
      res.setHeader('Set-Cookie', buildSessionCookie(sessionToken, { secure: isProd() }));
      return { userId };
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        throw new UnauthorizedException({
          error: { code: 'invalid_credentials', message: 'Invalid email or password' },
        });
      }
      throw err;
    }
  }

  @Get('session')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.OK)
  async session(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    // SessionGuard guarantees req.user.id by the time we get here — but we
    // still need a runtime null-check to keep the type system honest (the
    // guard sets `req.user` as optional on the type).
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException({
        error: { code: 'invalid_credentials', message: 'Invalid or expired session' },
      });
    }
    try {
      const user = await this.auth.getUserById(userId);
      if (!user) {
        // Stale session — the cookie passed the guard (session row exists)
        // but the user row was deleted out from under it. Clear the cookie
        // so the client stops re-sending it and reject with 401.
        res.setHeader('Set-Cookie', buildClearedSessionCookie({ secure: isProd() }));
        throw new UnauthorizedException({
          error: { code: 'invalid_credentials', message: 'Invalid or expired session' },
        });
      }
      return { userId: user.id, email: user.email };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      captureApiError({
        err,
        feature: 'auth',
        layer: 'controller',
        statusClass: '5xx',
        extra: { route: 'GET /auth/session', userId },
      });
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await this.auth.logout(token);
    }
    res.setHeader('Set-Cookie', buildClearedSessionCookie({ secure: isProd() }));
  }
}
