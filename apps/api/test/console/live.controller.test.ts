import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { Test } from '@nestjs/testing';
import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'express';
import { LiveController } from '../../src/console/live.controller';
import { LiveBadgeService } from '../../src/console/live-badge.service';
import { SseHub } from '../../src/console/sse-hub';
import { SessionGuard, type AuthenticatedRequest } from '../../src/auth/session.guard';
import { API_CONFIG_TOKEN, type ApiConfig } from '../../src/common/config';
import type { LiveBadgeState, SseTick } from '@argus/contracts';

const config = { heartbeatIntervalMs: 10_000, sseDebounceMs: 50 } as ApiConfig;

function fakeReqRes(userId: string): { req: AuthenticatedRequest; res: Response; chunks: string[] } {
  const req = Object.assign(new EventEmitter(), { user: { id: userId } }) as unknown as AuthenticatedRequest;
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    getHeader(k: string) {
      return headers[k];
    },
    flushHeaders() {},
    write(c: string) {
      chunks.push(c);
      return true;
    },
    end() {},
  } as unknown as Response;
  return { req, res, chunks };
}

function badge(state: LiveBadgeState = { state: 'live', lagSeconds: 2 }): LiveBadgeService {
  return { state: async () => state } as unknown as LiveBadgeService;
}

describe('LiveController.live (stream semantics)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('handshake: 200 text/event-stream headers + a retry directive', async () => {
    const hub = new SseHub(config);
    const ctrl = new LiveController(badge(), hub, config);
    const { req, res, chunks } = fakeReqRes(randomUUID());
    await ctrl.live(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.getHeader('Content-Type')).toBe('text/event-stream');
    expect(res.getHeader('Cache-Control')).toBe('no-cache');
    expect(chunks[0]).toBe('retry: 3000\n\n');
  });

  it('emits the initial badge state as the first data event', async () => {
    const hub = new SseHub(config);
    const ctrl = new LiveController(badge({ state: 'behind', lagSeconds: 9 }), hub, config);
    const { req, res, chunks } = fakeReqRes(randomUUID());
    await ctrl.live(req, res);
    const dataLine = chunks.find((c) => c.startsWith('data:'))!;
    const payload = JSON.parse(dataLine.slice('data: '.length)) as LiveBadgeState;
    expect(payload).toEqual({ state: 'behind', lagSeconds: 9 });
  });

  it('delivers a tick to the subscriber; a different user gets nothing', async () => {
    const hub = new SseHub(config);
    const userId = randomUUID();
    const ctrl = new LiveController(badge(), hub, config);
    const { req, res, chunks } = fakeReqRes(userId);
    await ctrl.live(req, res);
    const beforeLen = chunks.length;

    const tick: SseTick = { type: 'tick', user_id: userId, kind: 'chat', conversation_id: randomUUID() };
    hub.publish(userId, tick);
    hub.publish(randomUUID(), { ...tick, user_id: randomUUID() }); // other user
    jest.advanceTimersByTime(config.sseDebounceMs);

    const newData = chunks.slice(beforeLen).filter((c) => c.startsWith('data:'));
    expect(newData).toHaveLength(1);
    expect(JSON.parse(newData[0]!.slice('data: '.length)).type).toBe('tick');
  });

  it('unsubscribes on disconnect (later publishes never reach the closed stream)', async () => {
    const hub = new SseHub(config);
    const userId = randomUUID();
    const ctrl = new LiveController(badge(), hub, config);
    const { req, res, chunks } = fakeReqRes(userId);
    await ctrl.live(req, res);

    (req as unknown as EventEmitter).emit('close');
    const beforeLen = chunks.length;
    hub.publish(userId, { type: 'tick', user_id: userId, kind: 'chat', conversation_id: randomUUID() });
    jest.advanceTimersByTime(config.sseDebounceMs);
    expect(chunks.slice(beforeLen).filter((c) => c.startsWith('data:'))).toHaveLength(0);
  });

  it('writes a keep-alive comment ping at half the heartbeat cadence (not a data event)', async () => {
    const hub = new SseHub(config);
    const ctrl = new LiveController(badge(), hub, config);
    const { req, res, chunks } = fakeReqRes(randomUUID());
    await ctrl.live(req, res);
    const beforeLen = chunks.length;
    jest.advanceTimersByTime(config.heartbeatIntervalMs / 2);
    const pings = chunks.slice(beforeLen).filter((c) => c.startsWith(': ping'));
    expect(pings.length).toBeGreaterThanOrEqual(1);
    expect(chunks.slice(beforeLen).some((c) => c.startsWith('data:'))).toBe(false);
  });
});

describe('LiveController auth', () => {
  let app: INestApplication;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('401s an unauthenticated request without opening a stream', async () => {
    const stubGuard = {
      canActivate: (ctx: ExecutionContext): boolean => {
        const r = ctx.switchToHttp().getRequest();
        if (!r.headers['x-user-id']) throw new UnauthorizedException();
        r.user = { id: r.headers['x-user-id'] };
        return true;
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [LiveController],
      providers: [
        { provide: LiveBadgeService, useValue: badge() },
        { provide: SseHub, useValue: new SseHub(config) },
        { provide: API_CONFIG_TOKEN, useValue: config },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue(stubGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).get('/console/live').expect(401);
  });
});
