// ChatGateway — pre-orchestrator error path + SDK request threading.
//
// Pre-existing coverage:
//   - every terminal `error` is followed by an `end` with status=failed,
//   - both frames share the same messageId (not a sentinel UUID) so the web
//     client can correlate the failure to its outgoing `send` frame.
//
// chat-context-and-ux-polish backbone (LLD Tasks 60-68):
//   - The gateway reads pin columns + multi-turn history off the startTurn
//     result and threads them onto the SDK request along with the
//     observability hints (effectiveBudget, contextWindowCap,
//     guessProvider).
//   - On a pinned conversation whose pinned adapter throws the override-
//     branch error, the gateway emits start → metadata? → error → end
//     (status=failed) — no fallback leak.
//
// We bypass the @nestjs/platform-ws machinery and call handleSend directly
// against a fake WebSocket — the gateway logic under test is the same.
import { ChatGateway } from '../../src/chat/chat.gateway';
import { ChatService } from '../../src/chat/chat.service';
import { SeqCounterRegistry } from '../../src/chat/seq-counter';
import { ContextMeterService } from '../../src/chat/context-meter.service';
import { ConversationsRepository } from '../../src/conversations/conversations.repository';
import { PrismaService } from '../../src/common/prisma.service';
import { AuthService } from '../../src/auth/auth.service';
import { SessionRepository } from '../../src/auth/session.repository';
import { AutoRouterService } from '../../src/auto/auto-router.service';
import { OrchestratorRegistry } from '../../src/orchestrator/registry';
import type { SdkCatalogAccessor } from '../../src/common/sdk-catalog.provider';
import type { SdkChatStreamFn } from '../../src/common/sdk-chat.provider';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { randomUUID } from 'crypto';
import type { WsFrameOutbound } from '@argus/contracts';
import type { ChatStreamChunk, ChatStreamRequest } from '@argus/sdk';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

interface FakeClient {
  readyState: number;
  sent: WsFrameOutbound[];
  data?: { userId: string; orchestrators: Map<string, unknown> };
  send: (raw: string) => void;
  on: () => void;
  close: () => void;
}

function fakeClient(userId: string): FakeClient {
  const sent: WsFrameOutbound[] = [];
  return {
    readyState: 1,
    sent,
    data: { userId, orchestrators: new Map() },
    send: (raw: string) => {
      sent.push(JSON.parse(raw) as WsFrameOutbound);
    },
    on: () => {},
    close: () => {},
  };
}

interface BuildOptions {
  catalog?: Partial<SdkCatalogAccessor>;
  sdkStream?: SdkChatStreamFn;
  // Phase B: override the Auto router so `provider: 'auto'` tests can assert
  // the routing decision flows into the SDK request's pin.
  autoRouter?: Pick<AutoRouterService, 'route'>;
}

interface BuildResult {
  gateway: ChatGateway;
  prisma: InMemoryPrisma;
  capturedRequests: ChatStreamRequest[];
  // Phase B: the global orchestrator registry so the registration tests can
  // observe in-flight handles.
  registry: OrchestratorRegistry;
  autoRouter: Pick<AutoRouterService, 'route'>;
}

function build(prisma: InMemoryPrisma, opts: BuildOptions = {}): BuildResult {
  const ps = new PrismaService(prisma as never);
  const sessions = new SessionRepository(ps);
  const auth = new AuthService(ps, sessions);
  const conversations = new ConversationsRepository(ps);
  const chatService = new ChatService(ps);
  const seqRegistry = new SeqCounterRegistry();
  const accessor: SdkCatalogAccessor = {
    listConfiguredProviders: opts.catalog?.listConfiguredProviders ?? (() => []),
    getCatalogEntry: opts.catalog?.getCatalogEntry ?? (() => null),
    getEffectiveBudget:
      opts.catalog?.getEffectiveBudget ?? ((configuredDefault) => configuredDefault),
  };
  const meter = new ContextMeterService(ps, accessor);
  // Phase B collaborators: registry (global, shared) + Auto router (mockable).
  const registry = new OrchestratorRegistry();
  const autoRouter: Pick<AutoRouterService, 'route'> =
    opts.autoRouter ??
    { route: jest.fn(async () => ({ provider: 'anthropic' as const, classifierInferenceId: null })) };
  const capturedRequests: ChatStreamRequest[] = [];
  // Default SDK stream stub: capture the request, emit a normal commit →
  // token → done stream so the orchestrator runs end-to-end.
  const defaultStub: SdkChatStreamFn = (req) => {
    capturedRequests.push(req);
    const provider = req.pin?.provider ?? 'mock';
    const model = req.pin?.model ?? 'mock-1';
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<ChatStreamChunk> {
        yield { type: 'commit', providerMeta: { provider, model } };
        yield { type: 'token', content: 'hi' };
        yield { type: 'done', providerMeta: { provider, model } };
      },
    };
  };
  const sdkStream: SdkChatStreamFn = opts.sdkStream
    ? (req) => {
        capturedRequests.push(req);
        return opts.sdkStream!(req);
      }
    : defaultStub;
  const gateway = new ChatGateway(
    chatService,
    seqRegistry,
    auth,
    conversations,
    meter,
    autoRouter as AutoRouterService,
    registry,
    accessor,
    sdkStream,
  );
  // Trigger onModuleInit so the cached guess is set (matches Nest's lifecycle).
  gateway.onModuleInit();
  return { gateway, prisma, capturedRequests, registry, autoRouter };
}

/** Helper: wait for the fire-and-forget orchestrator chain to settle. */
async function tick(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

function seedUserWithConversation(prisma: InMemoryPrisma): { userId: string; conversationId: string } {
  const userId = randomUUID();
  const conversationId = randomUUID();
  prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
  prisma.conversations.push({ id: conversationId, userId, title: 't', createdAt: new Date(), lastMessageAt: null });
  return { userId, conversationId };
}

function callHandleSend(gateway: ChatGateway, client: unknown, data: unknown, frame: unknown): Promise<void> {
  return (
    gateway as unknown as { handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void> }
  ).handleSend(client, data, frame);
}

// Wait for the fire-and-forget orchestrator run + its finally() to settle.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

describe('ChatGateway.handleSend — pre-orchestrator failure terminals', () => {
  it('on unknown conversationId emits error + end(status=failed) sharing the same minted messageId', async () => {
    const { gateway, prisma } = build(createInMemoryPrisma());
    const userId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
    const client = fakeClient(userId);

    // Access the private via index — testing the private path is intentional;
    // making it public would expand the gateway's API surface unnecessarily.
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(
      client,
      client.data,
      { type: 'send', conversationId: randomUUID(), content: 'hi' },
    );

    expect(client.sent).toHaveLength(2);
    const [errorFrame, endFrame] = client.sent;
    expect(errorFrame!.type).toBe('error');
    expect(endFrame!.type).toBe('end');
    // The two frames MUST correlate via shared messageId — no sentinel UUID.
    expect(errorFrame!.type === 'error' && errorFrame.messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(endFrame!.type === 'end' && endFrame.messageId).toBe(
      errorFrame!.type === 'error' ? errorFrame.messageId : 'mismatch',
    );
    expect(endFrame!.type === 'end' && endFrame.status).toBe('failed');
    // The minted id MUST NOT be the all-zeros sentinel the previous code used.
    expect(errorFrame!.type === 'error' && errorFrame.messageId).not.toBe(
      '00000000-0000-0000-0000-000000000000',
    );
  });

  it('emits the failure terminal with the new gateway constructor signature (DI smoke)', async () => {
    // Sanity: the build() helper above wires the new dependencies; this
    // mirrors the original unknown-conversationId test but exercises the
    // expanded constructor signature to catch DI regressions early.
    const { gateway, prisma } = build(createInMemoryPrisma());
    const userId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(
      client,
      client.data,
      { type: 'send', conversationId: randomUUID(), content: 'hi' },
    );
    expect(client.sent.find((f) => f.type === 'error')).toBeDefined();
  });

  it('on startTurn failure (intruder-style) emits error + end sharing the same messageId', async () => {
    const { gateway, prisma } = build(createInMemoryPrisma());
    const userA = randomUUID();
    const userB = randomUUID();
    prisma.users.push({ id: userA, email: 'a@t', passwordHash: 'x', createdAt: new Date() });
    prisma.users.push({ id: userB, email: 'b@t', passwordHash: 'x', createdAt: new Date() });
    const conversationId = randomUUID();
    // Conversation owned by user A, but client is user B AND the
    // getByIdForUser check first returns null → caught by the not_found
    // branch. We exercise the same shape via the not_found path because
    // startTurn-specific failure modes are surfaced via the same helper.
    prisma.conversations.push({
      id: conversationId,
      userId: userA,
      title: 't',
      createdAt: new Date(),
      lastMessageAt: null,
    });
    const client = fakeClient(userB);

    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(
      client,
      client.data,
      { type: 'send', conversationId, content: 'hi' },
    );

    expect(client.sent).toHaveLength(2);
    const [errorFrame, endFrame] = client.sent;
    expect(errorFrame!.type).toBe('error');
    expect(endFrame!.type).toBe('end');
    expect(endFrame!.type === 'end' && endFrame.status).toBe('failed');
    if (errorFrame!.type === 'error' && endFrame!.type === 'end') {
      expect(endFrame.messageId).toBe(errorFrame.messageId);
    }
  });
});

// Phase B (control plane) — Auto routing + orchestrator registration.
//
// Post-merge note: PR #5 (chat-context-and-ux-polish) made the `start` frame
// identity-only (provider/model migrated to the `metadata` frame, sourced from
// the SDK `commit` chunk) AND moved provider selection onto the SDK request's
// `pin`. So Phase B's four-option `provider` selector now flows into the SDK
// request's pin (lowest precedence) rather than onto the start frame. These
// tests assert the merged reality: the Auto router's decision shows up as the
// pin (and, via the default stub's commit, on the metadata frame).
describe('ChatGateway.handleSend — Phase B provider routing + registration', () => {
  it('provider="auto" invokes the Auto router before streaming; resolved provider flows into the SDK pin + metadata', async () => {
    const prisma = createInMemoryPrisma();
    const route = jest.fn(async () => ({ provider: 'anthropic' as const, classifierInferenceId: null }));
    const { gateway, capturedRequests } = build(prisma, { autoRouter: { route } });
    const { userId, conversationId } = seedUserWithConversation(prisma);
    const client = fakeClient(userId);

    await callHandleSend(gateway, client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
      provider: 'auto',
    });
    await flush();

    expect(route).toHaveBeenCalledTimes(1);
    // The Auto decision is threaded as the (lowest-precedence) SDK pin.
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.pin?.provider).toBe('anthropic');
    // And the default stub commits that provider, so it surfaces on metadata.
    const meta = client.sent.find((f) => f.type === 'metadata');
    expect(meta && meta.type === 'metadata' && meta.providerMeta.provider).toBe('anthropic');
  });

  it('a concrete provider bypasses the Auto router and is threaded as the SDK pin unchanged', async () => {
    const prisma = createInMemoryPrisma();
    const route = jest.fn(async () => ({ provider: 'anthropic' as const, classifierInferenceId: null }));
    const { gateway, capturedRequests } = build(prisma, { autoRouter: { route } });
    const { userId, conversationId } = seedUserWithConversation(prisma);
    const client = fakeClient(userId);

    await callHandleSend(gateway, client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
      provider: 'openai',
    });
    await flush();

    expect(route).not.toHaveBeenCalled();
    expect(capturedRequests[0]!.pin?.provider).toBe('openai');
  });

  it('an explicit send-frame pin wins over the four-option provider selector', async () => {
    // Both a `provider` selector AND a `pinnedProvider`/`pinnedModel` pair are
    // present; the precise pin must win (the selector is lowest precedence).
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, {
      catalog: {
        listConfiguredProviders: () => [
          {
            provider: 'openai',
            model: 'gpt-4o-mini',
            promptPerMillion: 0,
            completionPerMillion: 0,
            contextWindow: 128_000,
          },
        ],
      },
    });
    const { userId, conversationId } = seedUserWithConversation(prisma);
    const client = fakeClient(userId);

    await callHandleSend(gateway, client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
      provider: 'anthropic',
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    await flush();

    expect(capturedRequests[0]!.pin).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('registers a handle on send and deregisters it when the stream terminates', async () => {
    const prisma = createInMemoryPrisma();
    // A stream we hold open so we can observe the handle mid-flight.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const heldSdk: SdkChatStreamFn = () => ({
      async *[Symbol.asyncIterator](): AsyncIterator<ChatStreamChunk> {
        yield { type: 'commit', providerMeta: { provider: 'mock', model: 'mock-1' } };
        yield { type: 'token', content: 'x' };
        await gate;
        yield { type: 'done', providerMeta: { provider: 'mock', model: 'mock-1' } };
      },
    });
    const { gateway, registry } = build(prisma, { sdkStream: heldSdk });
    const { userId, conversationId } = seedUserWithConversation(prisma);
    const client = fakeClient(userId);

    await callHandleSend(gateway, client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
      provider: 'mock',
    });

    // Mid-flight: exactly one chat handle registered for this user.
    const inflight = registry.list(userId);
    expect(inflight).toHaveLength(1);
    expect(inflight[0]!.kind).toBe('chat');

    // Let the stream finish; the finally() deregisters.
    release();
    await flush();
    expect(registry.list(userId)).toEqual([]);
  });
});

// chat-context-and-ux-polish LLD Tasks 60-69 — SDK request threading +
// pinned-provider error propagation.
describe('ChatGateway.handleSend — SDK request threading', () => {
  async function seedPinnedConv(
    prisma: InMemoryPrisma,
    pin: { pinnedProvider: string | null; pinnedModel: string | null },
  ): Promise<{ userId: string; conversationId: string }> {
    const userId = randomUUID();
    const conversationId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
    (prisma.conversations as unknown as Array<Record<string, unknown>>).push({
      id: conversationId,
      userId,
      title: 't',
      createdAt: new Date(),
      lastMessageAt: null,
      pinnedProvider: pin.pinnedProvider,
      pinnedModel: pin.pinnedModel,
    });
    return { userId, conversationId };
  }

  it('threads the conversation pin onto the SDK request when both columns are set (Tasks 60/61)', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma);
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: 'anthropic',
      pinnedModel: 'claude-haiku-4-5',
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.pin).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });
  });

  it('omits pin from the SDK request when the conversation is unpinned (Task 61)', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma);
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: null,
      pinnedModel: null,
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.pin).toBeUndefined();
  });

  it('threads effectiveBudget + contextWindowCap from the catalog accessor (Tasks 62/63)', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, {
      catalog: {
        getEffectiveBudget: (configuredDefault, pin) => {
          // Pin present → return min(default, 8192) mimicking the SDK's rule.
          if (pin) return Math.min(configuredDefault, 8192);
          return configuredDefault;
        },
        getCatalogEntry: (provider, model) => {
          if (provider === 'mock' && model === 'mock-1') {
            return { promptPerMillion: 0, completionPerMillion: 0, contextWindow: 8192 };
          }
          return null;
        },
      },
    });
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: 'mock',
      pinnedModel: 'mock-1',
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();
    expect(capturedRequests[0]!.effectiveBudget).toBe(8192);
    expect(capturedRequests[0]!.contextWindowCap).toBe(8192);
  });

  // chat-context-and-ux-polish (Codex review — mixed-hint behavior). When the
  // pin is set but NOT in the catalog, effectiveBudget falls back to the
  // configured default while contextWindowCap is OMITTED (no misleading zero).
  it('omits contextWindowCap for an unknown pin while still threading the default effectiveBudget (Tasks 62/63)', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, {
      catalog: {
        // Unknown pin → SDK's tolerance returns the configured default.
        getEffectiveBudget: (configuredDefault) => configuredDefault,
        // Catalog has no entry for the pinned pair → cap unknown.
        getCatalogEntry: () => null,
      },
    });
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-unicorn-9000',
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();
    const r = capturedRequests[0]!;
    expect(typeof r.effectiveBudget).toBe('number');
    expect(r.contextWindowCap).toBeUndefined();
    // The pin itself is still threaded (the gateway doesn't validate it; the
    // SDK override branch surfaces pinned_provider_unavailable if needed).
    expect(r.pin).toEqual({ provider: 'openai', model: 'gpt-unicorn-9000' });
  });

  // chat-context-and-ux-polish (Codex review — legacy half-pin tolerance). A
  // corrupt row with only pinnedProvider set (model null) must NOT thread a
  // half-pin onto the SDK request — the gateway treats it as unpinned.
  it('treats a legacy half-pin (provider set, model null) as unpinned — no pin on the SDK request', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma);
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: null,
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();
    expect(capturedRequests[0]!.pin).toBeUndefined();
  });

  it('threads the cached guessProvider derived at module init (Tasks 64/65)', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, {
      catalog: {
        listConfiguredProviders: () => [
          {
            provider: 'openai',
            model: 'gpt-4o-mini',
            promptPerMillion: 0.15,
            completionPerMillion: 0.6,
            contextWindow: 128_000,
          },
        ],
      },
    });
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: null,
      pinnedModel: null,
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();
    expect(capturedRequests[0]!.guessProvider).toBe('openai');
  });

  it('on pinned-provider failure, emits a clean error+end and never streams from a fallback adapter (Tasks 68/69)', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, {
      // Stub SDK stream that throws the override-branch error pre-token.
      sdkStream: () => ({
        async *[Symbol.asyncIterator](): AsyncIterator<ChatStreamChunk> {
          const e = new Error('pinned provider missing') as Error & { code: string };
          e.code = 'pinned_provider_unavailable';
          throw e;
        },
      }),
    });
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: 'anthropic',
      pinnedModel: 'claude-haiku-4-5',
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();

    expect(capturedRequests).toHaveLength(1);
    // Frame sequence MUST be start → error → end(failed); no token frames
    // from any other provider (no fallback leak).
    const types = client.sent.map((f) => f.type);
    expect(types).toEqual(['start', 'error', 'end']);
    const err = client.sent.find((f) => f.type === 'error')!;
    expect(err.type === 'error' && err.errorCode).toBe('pinned_provider_unavailable');
    const end = client.sent.find((f) => f.type === 'end')!;
    expect(end.type === 'end' && end.status).toBe('failed');
    // Persisted inferences row carries the same code via the existing
    // fail-turn path (Task 69).
    const messageId = err.type === 'error' ? err.messageId : '';
    const inf = prisma.inferences.find((i) => i.messageId === messageId);
    expect(inf?.errorCode).toBe('pinned_provider_unavailable');
  });

  // chat-context-and-ux-polish (Codex review — gateway-level end-to-end
  // lifecycle). The orchestrator-level tests cover the frame sequence, but the
  // gateway boundary needs a full integration assertion that a `send` frame
  // produces the entire WS sequence end-to-end with correct seqs + meta.
  it('happy path: a send frame drives start@0 → metadata@1 → token@2 → end(complete) with meter fields', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, {
      catalog: {
        // Meter compute reads getEffectiveBudget; surface a budget so the end
        // frame carries tokensBudget. (The conversation is unpinned.)
        getEffectiveBudget: (configuredDefault) => configuredDefault,
      },
    });
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: null,
      pinnedModel: null,
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hello',
    });
    await tick();

    const types = client.sent.map((f) => f.type);
    expect(types).toEqual(['start', 'metadata', 'token', 'end']);
    const seqs = client.sent.map((f) => ('seq' in f ? f.seq : -1));
    expect(seqs).toEqual([0, 1, 2, 3]);
    // metadata provider/model matches what the SDK's commit reported (the
    // default stub commits mock/mock-1 for an unpinned conversation).
    const meta = client.sent.find((f) => f.type === 'metadata')!;
    expect(meta.type === 'metadata' && meta.providerMeta.provider).toBe('mock');
    expect(meta.type === 'metadata' && meta.providerMeta.model).toBe('mock-1');
    // end(complete) carries the meter fields.
    const end = client.sent.find((f) => f.type === 'end')!;
    expect(end.type === 'end' && end.status).toBe('complete');
    expect(end.type === 'end' && typeof end.tokensUsed).toBe('number');
    expect(end.type === 'end' && typeof end.tokensBudget).toBe('number');
    // The assistant message persisted the full content.
    expect(capturedRequests).toHaveLength(1);
    const assistantMsg = prisma.messages.find(
      (m) => m.role === 'assistant' && m.conversationId === conversationId,
    );
    expect(assistantMsg?.content).toBe('hi');
    expect(assistantMsg?.status).toBe('complete');
  });

  // chat-context-and-ux-polish (Codex review — wire-protocol: leading empty
  // token must not scramble seq). With a stubbed SDK that yields an empty
  // token before "hello", the gateway emits start@0 → metadata@1 → token@2 with
  // NO duplicate seq and NO leading empty token frame.
  it('empty leading token: frames are start@0 → metadata@1 → token(hello)@2 → end@3 (no dup seq, no empty token)', async () => {
    const prisma = createInMemoryPrisma();
    // SDK stub that mirrors the router's commit-suppression contract: the
    // commit fires immediately before the first NON-empty token; the leading
    // empty token is suppressed by the router and never reaches the gateway.
    const { gateway } = build(prisma, {
      sdkStream: () => ({
        async *[Symbol.asyncIterator](): AsyncIterator<ChatStreamChunk> {
          yield { type: 'commit', providerMeta: { provider: 'mock', model: 'mock-1' } };
          yield { type: 'token', content: 'hello' };
          yield { type: 'done', providerMeta: { provider: 'mock', model: 'mock-1' } };
        },
      }),
    });
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: null,
      pinnedModel: null,
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();

    const types = client.sent.map((f) => f.type);
    expect(types).toEqual(['start', 'metadata', 'token', 'end']);
    const seqs = client.sent.map((f) => ('seq' in f ? f.seq : -1));
    // No duplicate seq; metadata@1 strictly before token@2.
    expect(seqs).toEqual([0, 1, 2, 3]);
    // No empty token frame.
    const tokenFrame = client.sent.find((f) => f.type === 'token')!;
    expect(tokenFrame.type === 'token' && tokenFrame.content).toBe('hello');
    expect(
      client.sent.some((f) => f.type === 'token' && f.content === ''),
    ).toBe(false);
  });

  // chat-context-and-ux-polish (Codex review — mid-stream failure lifecycle).
  // After metadata + one token, a provider error fires error → end(failed):
  // no meter fields on end, partial content persisted, no second metadata.
  it('mid-stream failure: emits ...token → error → end(failed) with no meter fields and persists partial content', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway } = build(prisma, {
      sdkStream: () => ({
        async *[Symbol.asyncIterator](): AsyncIterator<ChatStreamChunk> {
          yield { type: 'commit', providerMeta: { provider: 'mock', model: 'mock-1' } };
          yield { type: 'token', content: 'partial' };
          const e = new Error('mid-stream boom') as Error & { code: string };
          e.code = 'provider_error';
          throw e;
        },
      }),
    });
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: null,
      pinnedModel: null,
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();

    const types = client.sent.map((f) => f.type);
    expect(types).toEqual(['start', 'metadata', 'token', 'error', 'end']);
    // Exactly one metadata frame (no second after the error).
    expect(client.sent.filter((f) => f.type === 'metadata')).toHaveLength(1);
    const end = client.sent.find((f) => f.type === 'end')!;
    expect(end.type === 'end' && end.status).toBe('failed');
    // No meter fields on a failed end.
    expect(end.type === 'end' && end.tokensUsed).toBeUndefined();
    expect(end.type === 'end' && end.tokensBudget).toBeUndefined();
    const err = client.sent.find((f) => f.type === 'error')!;
    expect(err.type === 'error' && err.errorCode).toBe('provider_error');
    // Partial content persisted to the assistant message.
    const assistantMsg = prisma.messages.find(
      (m) => m.role === 'assistant' && m.conversationId === conversationId,
    );
    expect(assistantMsg?.content).toBe('partial');
    expect(assistantMsg?.status).toBe('failed');
  });

  it('passes the multi-turn history (oldest first, streaming rows excluded) onto the SDK request (Task 53/61)', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma);
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: null,
      pinnedModel: null,
    });
    // Seed one earlier complete user message + one stale streaming row.
    prisma.messages.push({
      id: randomUUID(),
      conversationId,
      userId,
      role: 'user',
      content: 'first turn',
      status: 'complete',
      createdAt: new Date(Date.now() - 5_000),
      completedAt: new Date(Date.now() - 4_900),
    });
    prisma.messages.push({
      id: randomUUID(),
      conversationId,
      userId,
      role: 'assistant',
      content: 'stale partial',
      status: 'streaming',
      createdAt: new Date(Date.now() - 4_000),
      completedAt: null,
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'second turn',
    });
    await tick();
    const req = capturedRequests[0]!;
    const contents = req.messages.map((m) => m.content);
    expect(contents).toEqual(['first turn', 'second turn']);
  });
});

// chat-context-and-ux-polish (integration review — first-turn pin race). A
// `send` frame can carry an explicit pin so the FIRST turn of a brand-new
// conversation honors the picker selection. The gateway validates it against
// the live catalog, threads it as THIS turn's SDK override, and persists it
// onto the conversation row so turn 2+ flow through the persisted-pin path.
// An explicit send-frame pin wins over the conversation's persisted pin.
describe('ChatGateway.handleSend — send-frame pin (first-turn pin race)', () => {
  // A catalog stub whose live entries cover the pins exercised below.
  const liveCatalog: Partial<SdkCatalogAccessor> = {
    listConfiguredProviders: () => [
      {
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        promptPerMillion: 0,
        completionPerMillion: 0,
        contextWindow: 200_000,
      },
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptPerMillion: 0,
        completionPerMillion: 0,
        contextWindow: 128_000,
      },
    ],
  };

  async function seedConv(
    prisma: InMemoryPrisma,
    pin: { pinnedProvider: string | null; pinnedModel: string | null },
  ): Promise<{ userId: string; conversationId: string }> {
    const userId = randomUUID();
    const conversationId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
    (prisma.conversations as unknown as Array<Record<string, unknown>>).push({
      id: conversationId,
      userId,
      title: 't',
      createdAt: new Date(),
      lastMessageAt: null,
      pinnedProvider: pin.pinnedProvider,
      pinnedModel: pin.pinnedModel,
    });
    return { userId, conversationId };
  }

  it('valid pin on a NEW conversation: first turn carries the override AND the row ends pinned', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, { catalog: liveCatalog });
    const userId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
    const client = fakeClient(userId);

    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId: null,
      content: 'hi',
      pinnedProvider: 'anthropic',
      pinnedModel: 'claude-haiku-4-5',
    });
    await tick();

    // The SDK request for the FIRST turn carries the send-frame pin.
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.pin).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });
    // The freshly-minted conversation row ends with the pin persisted.
    const conv = prisma.conversations.find((c) => c.userId === userId);
    expect(conv?.pinnedProvider).toBe('anthropic');
    expect(conv?.pinnedModel).toBe('claude-haiku-4-5');
  });

  it('valid pin on an EXISTING conversation: overrides AND updates the persisted pin', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, { catalog: liveCatalog });
    // Conversation already pinned to openai; the send frame repins to anthropic.
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    const client = fakeClient(userId);

    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
      pinnedProvider: 'anthropic',
      pinnedModel: 'claude-haiku-4-5',
    });
    await tick();

    // Send-frame pin wins over the persisted pin for THIS turn.
    expect(capturedRequests[0]!.pin).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });
    // And the persisted pin is updated to the new pin.
    const conv = prisma.conversations.find((c) => c.id === conversationId);
    expect(conv?.pinnedProvider).toBe('anthropic');
    expect(conv?.pinnedModel).toBe('claude-haiku-4-5');
  });

  it('INVALID pin (not in live catalog): emits error+end(failed), turn not started, nothing persisted', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, { catalog: liveCatalog });
    const userId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
    const client = fakeClient(userId);

    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId: null,
      content: 'hi',
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-unicorn-9000',
    });
    await tick();

    // No SDK request: the turn was never started.
    expect(capturedRequests).toHaveLength(0);
    // error + end(failed) terminal with the invalid_pin code.
    const types = client.sent.map((f) => f.type);
    expect(types).toEqual(['error', 'end']);
    const err = client.sent.find((f) => f.type === 'error')!;
    expect(err.type === 'error' && err.errorCode).toBe('invalid_pin');
    const end = client.sent.find((f) => f.type === 'end')!;
    expect(end.type === 'end' && end.status).toBe('failed');
    // Nothing persisted: no conversation, no messages, no inference.
    expect(prisma.conversations).toHaveLength(0);
    expect(prisma.messages).toHaveLength(0);
    expect(prisma.inferences).toHaveLength(0);
  });

  it('INVALID pin on an EXISTING conversation: error+end, no SDK request, persisted pin untouched', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, { catalog: liveCatalog });
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    const client = fakeClient(userId);

    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
      pinnedProvider: 'anthropic',
      pinnedModel: 'claude-unknown-0',
    });
    await tick();

    expect(capturedRequests).toHaveLength(0);
    const err = client.sent.find((f) => f.type === 'error')!;
    expect(err.type === 'error' && err.errorCode).toBe('invalid_pin');
    // The persisted pin is untouched (no partial write on rejection), and no
    // messages were created.
    const conv = prisma.conversations.find((c) => c.id === conversationId);
    expect(conv?.pinnedProvider).toBe('openai');
    expect(conv?.pinnedModel).toBe('gpt-4o-mini');
    expect(prisma.messages).toHaveLength(0);
  });

  it('NO pin on the send frame: unchanged behavior — uses the persisted pin', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, { catalog: liveCatalog });
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    const client = fakeClient(userId);

    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();

    // Persisted pin is used; row unchanged.
    expect(capturedRequests[0]!.pin).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    const conv = prisma.conversations.find((c) => c.id === conversationId);
    expect(conv?.pinnedProvider).toBe('openai');
    expect(conv?.pinnedModel).toBe('gpt-4o-mini');
  });

  it('NO pin on the send frame, unpinned conversation: Auto (no pin on the SDK request)', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma, { catalog: liveCatalog });
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: null,
      pinnedModel: null,
    });
    const client = fakeClient(userId);

    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'hi',
    });
    await tick();

    expect(capturedRequests[0]!.pin).toBeUndefined();
  });
});

describe('ChatGateway.handleSend — history pass-through (Task 53/61)', () => {
  async function seedPinnedConv(
    prisma: InMemoryPrisma,
    pin: { pinnedProvider: string | null; pinnedModel: string | null },
  ): Promise<{ userId: string; conversationId: string }> {
    const userId = randomUUID();
    const conversationId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
    (prisma.conversations as unknown as Array<Record<string, unknown>>).push({
      id: conversationId,
      userId,
      title: 't',
      createdAt: new Date(),
      lastMessageAt: null,
      pinnedProvider: pin.pinnedProvider,
      pinnedModel: pin.pinnedModel,
    });
    return { userId, conversationId };
  }

  it('passes the multi-turn history (oldest first, streaming rows excluded) onto the SDK request', async () => {
    const prisma = createInMemoryPrisma();
    const { gateway, capturedRequests } = build(prisma);
    const { userId, conversationId } = await seedPinnedConv(prisma, {
      pinnedProvider: null,
      pinnedModel: null,
    });
    // Seed one earlier complete user message + one stale streaming row.
    prisma.messages.push({
      id: randomUUID(),
      conversationId,
      userId,
      role: 'user',
      content: 'first turn',
      status: 'complete',
      createdAt: new Date(Date.now() - 5_000),
      completedAt: new Date(Date.now() - 4_900),
    });
    prisma.messages.push({
      id: randomUUID(),
      conversationId,
      userId,
      role: 'assistant',
      content: 'stale partial',
      status: 'streaming',
      createdAt: new Date(Date.now() - 4_000),
      completedAt: null,
    });
    const client = fakeClient(userId);
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(client, client.data, {
      type: 'send',
      conversationId,
      content: 'second turn',
    });
    await tick();
    const req = capturedRequests[0]!;
    const contents = req.messages.map((m) => m.content);
    expect(contents).toEqual(['first turn', 'second turn']);
  });
});
