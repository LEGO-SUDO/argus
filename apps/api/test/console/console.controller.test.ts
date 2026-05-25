import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { ConsoleModule } from '../../src/console/console.module';
import { ConsoleController } from '../../src/console/console.controller';
import { SessionGuard } from '../../src/auth/session.guard';
import { PrismaService } from '../../src/common/prisma.service';
import { TracesRepository } from '../../src/console/traces.repository';
import { CostRepository } from '../../src/console/cost.repository';
import { ReplayRepository } from '../../src/console/replay.repository';
import { Aggregates } from '../../src/console/aggregates';
import { SamplesService } from '../../src/console/samples.service';
import { ClearService } from '../../src/console/clear.service';
import { LiveBadgeService } from '../../src/console/live-badge.service';
import { ReplayService } from '../../src/replay/replay.service';
import { SDK_CHAT_TOKEN, type SdkChat } from '../../src/common/sdk';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { seedInference } from './seed-inference';
import {
  TraceListResponseSchema,
  CostResponseSchema,
  ReplayCandidatesResponseSchema,
  ReplayDetailSchema,
} from '@argus/contracts';
import type { ChatStreamChunk } from '@argus/sdk';

const stubGuard = {
  canActivate: (ctx: ExecutionContext): boolean => {
    const req = ctx.switchToHttp().getRequest();
    const uid = req.headers['x-user-id'] as string | undefined;
    if (!uid) throw new UnauthorizedException();
    req.user = { id: uid };
    return true;
  },
};

const stubSdk: SdkChat = {
  async *stream(): AsyncIterable<ChatStreamChunk> {
    yield { type: 'token', content: 'x' };
    yield { type: 'done', providerMeta: { provider: 'mock', model: 'mock-1' } };
  },
};

let app: INestApplication;
let prisma: InMemoryPrisma;
let userId: string;

beforeEach(async () => {
  prisma = createInMemoryPrisma();
  const moduleRef = await Test.createTestingModule({ imports: [ConsoleModule] })
    .overrideProvider(PrismaService)
    .useValue({ db: prisma })
    .overrideProvider(SDK_CHAT_TOKEN)
    .useValue(stubSdk)
    .overrideGuard(SessionGuard)
    .useValue(stubGuard)
    .compile();
  app = moduleRef.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.init();
  userId = randomUUID();
  prisma.users.push({ id: userId, email: 'u@t', passwordHash: 'x', createdAt: new Date() });
  prisma.sessions.push({ id: randomUUID(), userId, tokenHash: 't', expiresAt: new Date(Date.now() + 1e9), createdAt: new Date(), currentSampleWorkspaceId: null });
});

afterEach(async () => {
  await app.close();
});

const authed = (m: request.Test): request.Test => m.set('x-user-id', userId);

describe('GET /console/traces', () => {
  it('200 + TraceListResponse shape when authed; 401 unauth; user-scoped', async () => {
    seedInference(prisma, userId, { startedAt: new Date() });
    seedInference(prisma, randomUUID(), { startedAt: new Date() }); // other user

    await request(app.getHttpServer()).get('/console/traces?window=24h').expect(401);

    const res = await authed(request(app.getHttpServer()).get('/console/traces?window=24h')).expect(200);
    expect(TraceListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.rows).toHaveLength(1);
  });

  it('400 on an invalid window value with the error envelope', async () => {
    const res = await authed(request(app.getHttpServer()).get('/console/traces?window=nope')).expect(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('parses repeated provider query keys into an IN(...) filter (R2 multi-select)', async () => {
    seedInference(prisma, userId, { provider: 'openai', startedAt: new Date() });
    seedInference(prisma, userId, { provider: 'anthropic', startedAt: new Date() });
    seedInference(prisma, userId, { provider: 'gemini', startedAt: new Date() });
    const res = await authed(
      request(app.getHttpServer()).get('/console/traces?window=24h&provider=openai&provider=anthropic'),
    ).expect(200);
    expect(TraceListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.rows).toHaveLength(2);
    expect(new Set(res.body.rows.map((r: { provider: string }) => r.provider))).toEqual(
      new Set(['openai', 'anthropic']),
    );
    // R3: every row carries a string traceId.
    expect(res.body.rows.every((r: { traceId: unknown }) => typeof r.traceId === 'string')).toBe(true);
  });
});

describe('GET /console/cost', () => {
  it('200 + CostResponse shape (groups, total, sparkline, unpriced)', async () => {
    seedInference(prisma, userId, { promptCost: 100, completionCost: 0, startedAt: new Date() });
    const res = await authed(request(app.getHttpServer()).get('/console/cost?window=24h')).expect(200);
    expect(CostResponseSchema.safeParse(res.body).success).toBe(true);
  });
});

describe('GET /console/replay/candidates', () => {
  it('200 + ReplayCandidatesResponse', async () => {
    seedInference(prisma, userId, { status: 'ok', startedAt: new Date() });
    const res = await authed(request(app.getHttpServer()).get('/console/replay/candidates?window=24h')).expect(200);
    expect(ReplayCandidatesResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.candidates.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /console/replay/:id', () => {
  it('200 detail for owner; 404 cross-user', async () => {
    const id = seedInference(prisma, userId, { status: 'ok', startedAt: new Date() });
    const res = await authed(request(app.getHttpServer()).get(`/console/replay/${id}`)).expect(200);
    expect(ReplayDetailSchema.safeParse(res.body).success).toBe(true);

    const otherId = seedInference(prisma, randomUUID(), { status: 'ok', startedAt: new Date() });
    await authed(request(app.getHttpServer()).get(`/console/replay/${otherId}`)).expect(404);
  });
});

describe('POST /console/replay/run', () => {
  function seedSource(): string {
    const conv = randomUUID();
    const asstMsg = randomUUID();
    const t = Date.now();
    prisma.conversations.push({ id: conv, userId, title: 'c', createdAt: new Date(), lastMessageAt: null });
    prisma.messages.push({ id: randomUUID(), conversationId: conv, userId, role: 'user', content: 'q', status: 'complete', createdAt: new Date(t - 1000), completedAt: new Date(t - 1000) });
    prisma.messages.push({ id: asstMsg, conversationId: conv, userId, role: 'assistant', content: 'a', status: 'complete', createdAt: new Date(t), completedAt: new Date(t) });
    return seedInference(prisma, userId, { messageId: asstMsg, conversationId: conv, status: 'ok', startedAt: new Date(t) });
  }

  it('200 returns the new replay message id', async () => {
    const sourceId = seedSource();
    const res = await authed(request(app.getHttpServer()).post('/console/replay/run').send({ sourceInferenceId: sourceId, provider: 'mock', model: 'mock-1' })).expect(200);
    expect(res.body.messageId).toBeDefined();
    expect(res.body.conversationId).toBeDefined();
  });

  it('400 on invalid body; 404 on cross-user source', async () => {
    await authed(request(app.getHttpServer()).post('/console/replay/run').send({ provider: 'mock' })).expect(400);
    const otherId = seedInference(prisma, randomUUID(), { status: 'ok', startedAt: new Date() });
    await authed(request(app.getHttpServer()).post('/console/replay/run').send({ sourceInferenceId: otherId, provider: 'mock', model: 'mock-1' })).expect(404);
  });
});

describe('POST /console/samples/generate', () => {
  it('200 with workspace id + count', async () => {
    const res = await authed(request(app.getHttpServer()).post('/console/samples/generate').send({ count: 3 })).expect(200);
    expect(res.body.workspaceId).toBeDefined();
    expect(res.body.count).toBe(3);
  });

  it('400 on a non-positive count', async () => {
    const res = await authed(request(app.getHttpServer()).post('/console/samples/generate').send({ count: 0 })).expect(400);
    expect(res.body.error.code).toBe('invalid_request');
  });
});

describe('POST /console/clear', () => {
  it("200 with the breakdown when confirmation='CLEAR'", async () => {
    seedInference(prisma, userId, { kind: 'chat', startedAt: new Date(Date.now() - 1000) });
    const res = await authed(request(app.getHttpServer()).post('/console/clear').send({ confirmation: 'CLEAR' })).expect(200);
    expect(res.body).toEqual({ total: 1, chat: 1, replay: 0, sample: 0 });
  });

  it('400 on any other confirmation string, writing nothing', async () => {
    seedInference(prisma, userId, { kind: 'chat', startedAt: new Date(Date.now() - 1000) });
    await authed(request(app.getHttpServer()).post('/console/clear').send({ confirmation: 'clear' })).expect(400);
    expect(prisma.userClearFences).toHaveLength(0);
    expect(prisma.inferences).toHaveLength(1);
  });
});

describe('GET /console/live/badge', () => {
  it('200 with the badge state', async () => {
    const res = await authed(request(app.getHttpServer()).get('/console/live/badge')).expect(200);
    expect(['live', 'behind', 'error']).toContain(res.body.state);
  });
});

describe('ConsoleController route ownership', () => {
  it('does NOT register GET /console/live; that path is LiveController-only', async () => {
    // A test app with ONLY ConsoleController registered (deps mocked).
    const moduleRef = await Test.createTestingModule({
      controllers: [ConsoleController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: TracesRepository, useValue: {} },
        { provide: CostRepository, useValue: {} },
        { provide: ReplayRepository, useValue: {} },
        { provide: Aggregates, useValue: {} },
        { provide: SamplesService, useValue: {} },
        { provide: ClearService, useValue: {} },
        { provide: LiveBadgeService, useValue: { state: async () => ({ state: 'live', lagSeconds: 0 }) } },
        { provide: ReplayService, useValue: {} },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue(stubGuard)
      .compile();
    const onlyConsole = moduleRef.createNestApplication();
    await onlyConsole.init();
    // ConsoleController owns /console/live/badge but NOT /console/live.
    await request(onlyConsole.getHttpServer()).get('/console/live/badge').set('x-user-id', userId).expect(200);
    await request(onlyConsole.getHttpServer()).get('/console/live').set('x-user-id', userId).expect(404);
    await onlyConsole.close();
  });
});
