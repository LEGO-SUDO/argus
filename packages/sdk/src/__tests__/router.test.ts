import { ProviderRouter } from '../router';
import { ProviderError } from '../index';
import type { ChatStreamChunk, ChatStreamRequest } from '../index';
import type { ProviderAdapter, ProviderName } from '../providers/types';

function makeReq(overrides: Partial<ChatStreamRequest> = {}): ChatStreamRequest {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    conversationId: 'c1',
    turnIndex: 0,
    userId: 'u1',
    messageId: 'm1',
    ...overrides,
  };
}

/** Adapter that yields a single token then `done`. */
function stubHappy(name: ProviderName, model = `${name}-1`): ProviderAdapter {
  return {
    name,
    isConfigured: () => true,
    listModels: () => [model],
    async *stream() {
      yield { type: 'token', content: `from-${name}` };
      yield {
        type: 'done',
        providerMeta: { provider: name, model, promptTokens: 1, completionTokens: 1 },
      };
    },
  };
}

/** Adapter that throws ProviderError BEFORE yielding anything. */
function stubPreTokenFail(name: ProviderName, code = 'auth_failed'): ProviderAdapter {
  return {
    name,
    isConfigured: () => true,
    listModels: () => [],
    // eslint-disable-next-line require-yield
    async *stream(): AsyncIterable<ChatStreamChunk> {
      throw new ProviderError(code, `${name} failed before first token`);
    },
  };
}

/** Adapter that reports not-configured. */
function stubUnconfigured(name: ProviderName): ProviderAdapter {
  return {
    name,
    isConfigured: () => false,
    listModels: () => [],
    async *stream() {
      throw new Error('should not be invoked');
    },
  };
}

async function collect(iter: AsyncIterable<ChatStreamChunk>): Promise<ChatStreamChunk[]> {
  const out: ChatStreamChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

/**
 * Helper: find the first non-commit chunk. The router now prepends a
 * synthetic `commit` chunk in front of the first non-empty token (LLD
 * Task 28); the legacy tests below assert on the first token, so they
 * skip the leading commit explicitly via this helper.
 */
function firstNonCommit(chunks: ChatStreamChunk[]): ChatStreamChunk | undefined {
  return chunks.find((c) => c.type !== 'commit');
}

describe('ProviderRouter', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('mockOnly=true short-circuits to the mock adapter', async () => {
    const router = new ProviderRouter({
      mockOnly: true,
      adapters: {
        mock: stubHappy('mock'),
        openai: stubPreTokenFail('openai'),
        anthropic: stubPreTokenFail('anthropic'),
        gemini: stubPreTokenFail('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    // Backbone adds a synthetic commit chunk in front of the first non-empty
    // token (LLD Task 28); the legacy assertion was on the first token —
    // skip the commit explicitly.
    expect(firstNonCommit(chunks)).toEqual({ type: 'token', content: 'from-mock' });
    // The terminal `done` chunk still carries the providerMeta the orchestrator
    // uses for the inferences-row enrichment.
    const done = chunks.find((c) => c.type === 'done');
    expect(done && done.type === 'done' && done.providerMeta.provider).toBe('mock');
  });

  it('walks the priority order until a provider yields a token', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic', 'gemini'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubHappy('openai'),
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(firstNonCommit(chunks)).toEqual({ type: 'token', content: 'from-openai' });
  });

  it('skips unconfigured providers', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic', 'gemini'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubUnconfigured('openai'),
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(firstNonCommit(chunks)).toEqual({ type: 'token', content: 'from-anthropic' });
  });

  it('fails over when a configured provider throws ProviderError before first token', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic', 'gemini'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubPreTokenFail('openai', 'auth_failed'),
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(firstNonCommit(chunks)).toEqual({ type: 'token', content: 'from-anthropic' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('openai failed before first token'));
  });

  it('falls back to mock when all configured real providers fail pre-token', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic', 'gemini'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubPreTokenFail('openai'),
        anthropic: stubPreTokenFail('anthropic'),
        gemini: stubPreTokenFail('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(firstNonCommit(chunks)).toEqual({ type: 'token', content: 'from-mock' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back to mock'));
  });

  it('throws no_providers_configured when MOCK_PROVIDER=false and zero keys are set', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic', 'gemini'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubUnconfigured('openai'),
        anthropic: stubUnconfigured('anthropic'),
        gemini: stubUnconfigured('gemini'),
      },
    });
    await expect(collect(router.stream(makeReq()))).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'no_providers_configured',
    });
  });

  it('respects custom order overriding the default openai-first preference', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['gemini', 'anthropic', 'openai'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubHappy('openai'),
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(firstNonCommit(chunks)).toEqual({ type: 'token', content: 'from-gemini' });
  });

  it('once committed to a provider, mid-stream errors propagate (no stitching)', async () => {
    const midStreamError: ProviderAdapter = {
      name: 'openai',
      isConfigured: () => true,
      listModels: () => [],
      async *stream() {
        yield { type: 'token', content: 'partial' };
        throw new Error('mid-stream boom');
      },
    };
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic'],
      adapters: {
        mock: stubHappy('mock'),
        openai: midStreamError,
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const iter = router.stream(makeReq())[Symbol.asyncIterator]();
    // Backbone: the router emits a synthetic commit chunk before the first
    // non-empty token (LLD Task 28). Pop it off first; the legacy invariant
    // (mid-stream errors propagate post-commit) is what the rest of the
    // test exercises.
    const commit = await iter.next();
    expect(commit.value && (commit.value as ChatStreamChunk).type).toBe('commit');
    const first = await iter.next();
    expect(first.value).toEqual({ type: 'token', content: 'partial' });
    await expect(iter.next()).rejects.toThrow('mid-stream boom');
  });

  // chat-context-and-ux-polish LLD Tasks 27-30 — synthetic `commit` chunk
  // emission. The router prepends a single commit chunk in front of the
  // first non-empty token so the orchestrator knows the final provider/model
  // before any token reaches the wire. Exactly-once invariant; never emits
  // on total provider failure.
  describe('commit chunk emission (Tasks 27/28/29/30)', () => {
    it('emits a synthetic commit chunk immediately before the first non-empty token', async () => {
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai'],
        adapters: {
          mock: stubHappy('mock'),
          openai: stubHappy('openai', 'gpt-4o-mini'),
          anthropic: stubHappy('anthropic'),
          gemini: stubHappy('gemini'),
        },
      });
      const chunks = await collect(router.stream(makeReq()));
      // First chunk is the synthetic commit carrying provider + model.
      expect(chunks[0]).toEqual({
        type: 'commit',
        providerMeta: { provider: 'openai', model: 'gpt-4o-mini' },
      });
      // Then the buffered first token from the adapter.
      expect(chunks[1]).toEqual({ type: 'token', content: 'from-openai' });
    });

    it('does NOT emit commit on a leading zero-length token; waits for the first non-empty token', async () => {
      // Adapter that yields '' (empty), then a real token, then done.
      const emptyThenReal: ProviderAdapter = {
        name: 'openai',
        isConfigured: () => true,
        listModels: () => ['gpt-4o-mini'],
        async *stream() {
          yield { type: 'token', content: '' };
          yield { type: 'token', content: 'real-token' };
          yield {
            type: 'done',
            providerMeta: { provider: 'openai', model: 'gpt-4o-mini' },
          };
        },
      };
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai'],
        adapters: {
          mock: stubHappy('mock'),
          openai: emptyThenReal,
          anthropic: stubHappy('anthropic'),
          gemini: stubHappy('gemini'),
        },
      });
      const chunks = await collect(router.stream(makeReq()));
      // First non-commit chunk: the empty token MAY pass through OR be
      // dropped — wire either; the load-bearing invariant is that commit
      // lands IMMEDIATELY BEFORE the first NON-empty token.
      const commitIdx = chunks.findIndex((c) => c.type === 'commit');
      const realTokenIdx = chunks.findIndex(
        (c) => c.type === 'token' && c.content === 'real-token',
      );
      expect(commitIdx).toBeGreaterThanOrEqual(0);
      expect(realTokenIdx).toBeGreaterThan(commitIdx);
      // No commit chunk precedes commitIdx (idempotence — see other tests too).
      expect(chunks.slice(0, commitIdx).every((c) => c.type !== 'commit')).toBe(true);
    });

    it('on total provider failure (no_providers_configured), emits NO commit chunk', async () => {
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai'],
        adapters: {
          mock: stubHappy('mock'),
          openai: stubUnconfigured('openai'),
          anthropic: stubUnconfigured('anthropic'),
          gemini: stubUnconfigured('gemini'),
        },
      });
      await expect(collect(router.stream(makeReq()))).rejects.toMatchObject({
        name: 'ProviderError',
        code: 'no_providers_configured',
      });
    });

    it('on failover from real adapter to mock, commit fires for mock (not for the failed real adapter)', async () => {
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai', 'anthropic'],
        adapters: {
          mock: stubHappy('mock'),
          openai: stubPreTokenFail('openai'),
          anthropic: stubPreTokenFail('anthropic'),
          gemini: stubPreTokenFail('gemini'),
        },
      });
      const chunks = await collect(router.stream(makeReq()));
      const commit = chunks.find((c) => c.type === 'commit');
      expect(commit).toBeDefined();
      expect(commit && commit.type === 'commit' && commit.providerMeta.provider).toBe('mock');
    });

    it('exactly-once: an adapter that defensively yields two non-empty tokens produces ONE commit chunk', async () => {
      const twoToken: ProviderAdapter = {
        name: 'openai',
        isConfigured: () => true,
        listModels: () => ['gpt-4o-mini'],
        async *stream() {
          yield { type: 'token', content: 'a' };
          yield { type: 'token', content: 'b' };
          yield {
            type: 'done',
            providerMeta: { provider: 'openai', model: 'gpt-4o-mini' },
          };
        },
      };
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai'],
        adapters: {
          mock: stubHappy('mock'),
          openai: twoToken,
          anthropic: stubHappy('anthropic'),
          gemini: stubHappy('gemini'),
        },
      });
      const chunks = await collect(router.stream(makeReq()));
      const commits = chunks.filter((c) => c.type === 'commit');
      expect(commits).toHaveLength(1);
    });
  });

  // chat-context-and-ux-polish LLD Tasks 31/32 — override branch via the
  // optional `pin` on the request. The pinned adapter handles the entire
  // request; failover is intentionally OFF for pinned turns.
  describe('override branch via request.pin (Tasks 31/32)', () => {
    it('a configured pinned adapter streams its token without walking the failover order', async () => {
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai', 'anthropic', 'gemini'],
        adapters: {
          mock: stubHappy('mock'),
          // openai is "happy" but should NOT be invoked when pin says anthropic.
          openai: stubHappy('openai'),
          anthropic: stubHappy('anthropic', 'claude-haiku-4-5'),
          gemini: stubHappy('gemini'),
        },
      });
      const chunks = await collect(
        router.stream(makeReq({ pin: { provider: 'anthropic', model: 'claude-haiku-4-5' } })),
      );
      const tokenChunk = chunks.find((c) => c.type === 'token');
      expect(tokenChunk).toEqual({ type: 'token', content: 'from-anthropic' });
      const commit = chunks.find((c) => c.type === 'commit');
      expect(commit && commit.type === 'commit' && commit.providerMeta.provider).toBe('anthropic');
      expect(commit && commit.type === 'commit' && commit.providerMeta.model).toBe(
        'claude-haiku-4-5',
      );
    });

    it('pinned adapter that throws pre-token surfaces `pinned_provider_unavailable` and DOES NOT fall back', async () => {
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai', 'anthropic', 'gemini'],
        adapters: {
          mock: stubHappy('mock'),
          openai: stubHappy('openai'),
          // The pinned one fails — must NOT walk to openai/mock.
          anthropic: stubPreTokenFail('anthropic', 'auth_failed'),
          gemini: stubHappy('gemini'),
        },
      });
      await expect(
        collect(router.stream(makeReq({ pin: { provider: 'anthropic', model: 'claude-haiku-4-5' } }))),
      ).rejects.toMatchObject({
        name: 'ProviderError',
        code: 'pinned_provider_unavailable',
      });
    });

    it('pin to a not-configured provider throws `pinned_provider_unavailable` without invoking any adapter', async () => {
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai', 'anthropic', 'gemini'],
        adapters: {
          mock: stubHappy('mock'),
          openai: stubHappy('openai'),
          anthropic: stubUnconfigured('anthropic'),
          gemini: stubHappy('gemini'),
        },
      });
      await expect(
        collect(router.stream(makeReq({ pin: { provider: 'anthropic', model: 'claude-haiku-4-5' } }))),
      ).rejects.toMatchObject({
        name: 'ProviderError',
        code: 'pinned_provider_unavailable',
      });
    });
  });

  // chat-context-and-ux-polish (Codex review #1) — the router's override
  // branch must thread the pin's model into the adapter's stream() call. An
  // adapter that reports `req.pin.model` (rather than its own default) is the
  // observable proof the pin reached the adapter.
  describe('pinned model propagation to the adapter (Codex review #1)', () => {
    it('routes the pinned request into the adapter with req.pin set, and the adapter resolves the pinned model', async () => {
      let capturedModel: string | null = null;
      // Adapter that resolves its model the same way the real adapters do
      // (req.pin?.model wins) and reports it on the commit/done meta.
      const modelReportingAdapter: ProviderAdapter = {
        name: 'anthropic',
        isConfigured: () => true,
        listModels: () => ['claude-haiku-4-5'],
        async *stream(req) {
          const model = req.pin?.model ?? 'claude-haiku-4-5';
          capturedModel = model;
          yield { type: 'token', content: 'hi' };
          yield { type: 'done', providerMeta: { provider: 'anthropic', model } };
        },
      };
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai', 'anthropic', 'gemini'],
        adapters: {
          mock: stubHappy('mock'),
          openai: stubHappy('openai'),
          anthropic: modelReportingAdapter,
          gemini: stubHappy('gemini'),
        },
      });
      await collect(
        router.stream(makeReq({ pin: { provider: 'anthropic', model: 'claude-opus-4-7' } })),
      );
      // The adapter saw the pinned model, NOT its default.
      expect(capturedModel).toBe('claude-opus-4-7');
    });

    it('the synthetic commit chunk carries the pinned model the adapter resolved', async () => {
      const adapter: ProviderAdapter = {
        name: 'anthropic',
        isConfigured: () => true,
        listModels: () => ['claude-haiku-4-5'],
        async *stream(req) {
          const model = req.pin?.model ?? 'claude-haiku-4-5';
          yield { type: 'token', content: 'hi' };
          yield { type: 'done', providerMeta: { provider: 'anthropic', model } };
        },
      };
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['anthropic'],
        adapters: {
          mock: stubHappy('mock'),
          openai: stubHappy('openai'),
          anthropic: adapter,
          gemini: stubHappy('gemini'),
        },
      });
      const chunks = await collect(
        router.stream(makeReq({ pin: { provider: 'anthropic', model: 'claude-opus-4-7' } })),
      );
      const commit = chunks.find((c) => c.type === 'commit');
      expect(commit && commit.type === 'commit' && commit.providerMeta.model).toBe(
        'claude-opus-4-7',
      );
    });
  });

  // chat-context-and-ux-polish (Codex review — wire-protocol violation). A
  // leading empty token must NOT be forwarded before the commit signal: doing
  // so ships a WS token@1 and then metadata also wants seq=1 (duplicate seq +
  // metadata-after-token). The router must suppress the leading empty token
  // and emit commit immediately before the first NON-empty token.
  describe('leading empty token suppression (Codex review)', () => {
    it('emits commit → token(hello) with the leading empty token suppressed', async () => {
      const emptyThenHello: ProviderAdapter = {
        name: 'openai',
        isConfigured: () => true,
        listModels: () => ['gpt-4o-mini'],
        async *stream() {
          yield { type: 'token', content: '' };
          yield { type: 'token', content: 'hello' };
          yield { type: 'done', providerMeta: { provider: 'openai', model: 'gpt-4o-mini' } };
        },
      };
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai'],
        adapters: {
          mock: stubHappy('mock'),
          openai: emptyThenHello,
          anthropic: stubHappy('anthropic'),
          gemini: stubHappy('gemini'),
        },
      });
      const chunks = await collect(router.stream(makeReq()));
      // Drop the trailing `done` for the ordering assertion.
      const nonDone = chunks.filter((c) => c.type !== 'done');
      // EXACTLY: commit then the hello token. No leading empty token.
      expect(nonDone).toHaveLength(2);
      expect(nonDone[0]!.type).toBe('commit');
      expect(nonDone[1]).toEqual({ type: 'token', content: 'hello' });
      // No empty-content token frame anywhere in the stream.
      expect(
        chunks.some((c) => c.type === 'token' && c.content === ''),
      ).toBe(false);
    });

    it('coalesces a mid-stream zero-length token after commit (defensive)', async () => {
      const emptyMidStream: ProviderAdapter = {
        name: 'openai',
        isConfigured: () => true,
        listModels: () => ['gpt-4o-mini'],
        async *stream() {
          yield { type: 'token', content: 'a' };
          yield { type: 'token', content: '' };
          yield { type: 'token', content: 'b' };
          yield { type: 'done', providerMeta: { provider: 'openai', model: 'gpt-4o-mini' } };
        },
      };
      const router = new ProviderRouter({
        mockOnly: false,
        order: ['openai'],
        adapters: {
          mock: stubHappy('mock'),
          openai: emptyMidStream,
          anthropic: stubHappy('anthropic'),
          gemini: stubHappy('gemini'),
        },
      });
      const chunks = await collect(router.stream(makeReq()));
      const tokenContents = chunks
        .filter((c) => c.type === 'token')
        .map((c) => (c.type === 'token' ? c.content : ''));
      // The empty mid-stream token is dropped; only 'a' and 'b' survive.
      expect(tokenContents).toEqual(['a', 'b']);
    });
  });

  it('treats an empty stream as a pre-token failure and fails over', async () => {
    const emptyAdapter: ProviderAdapter = {
      name: 'openai',
      isConfigured: () => true,
      listModels: () => [],
      // eslint-disable-next-line require-yield
      async *stream() {
        return;
      },
    };
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic'],
      adapters: {
        mock: stubHappy('mock'),
        openai: emptyAdapter,
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(firstNonCommit(chunks)).toEqual({ type: 'token', content: 'from-anthropic' });
  });
});
