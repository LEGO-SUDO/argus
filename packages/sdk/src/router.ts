// Provider router — priority list with pre-first-token failover.
//
// Selection:
//   1. If MOCK_PROVIDER=true (env, default true) → always mock. This is the
//      keyless dev path. Mock keeps every test/demo deterministic.
//   2. Else, walk PROVIDER_ORDER (default: openai,anthropic,gemini). For each:
//        - skip if !adapter.isConfigured()
//        - call adapter.stream(req). If it throws ProviderError BEFORE
//          yielding a token → log + try the next.
//        - if it yields a token → commit; subsequent errors propagate to the
//          orchestrator (mid-stream failures are NOT failed over — we'd be
//          stitching token sequences from two providers, which corrupts the
//          assistant message).
//   3. If every configured real provider fails pre-token → fall back to mock
//      with a warning. This keeps the UX alive even when the entire upstream
//      tier is down; the mock response is visibly the mock vocabulary so the
//      operator can tell.
//   4. If NO provider is configured AND MOCK_PROVIDER=false → throw
//      ProviderError('no_providers_configured', ...). The orchestrator will
//      surface this on the WS error frame.

import type { ProviderAdapter, ProviderName } from './providers/types';
import type { ChatStreamChunk, ChatStreamRequest } from './index';
import { ProviderError } from './index';
import { mockProvider } from './providers/mock';
import { openaiProvider } from './providers/openai';
import { anthropicProvider } from './providers/anthropic';
import { geminiProvider } from './providers/gemini';

const DEFAULT_ORDER: ProviderName[] = ['openai', 'anthropic', 'gemini'];

export interface RouterOptions {
  /** Override env for tests. */
  mockOnly?: boolean;
  /** Override env-driven priority order. */
  order?: ProviderName[];
  /**
   * Override the adapter registry. Useful for tests that want to inject stub
   * providers without monkey-patching modules.
   */
  adapters?: Partial<Record<ProviderName, ProviderAdapter>>;
}

export class ProviderRouter {
  private readonly adapters: Record<ProviderName, ProviderAdapter>;

  constructor(private readonly opts: RouterOptions = {}) {
    this.adapters = {
      mock: opts.adapters?.mock ?? mockProvider,
      openai: opts.adapters?.openai ?? openaiProvider,
      anthropic: opts.adapters?.anthropic ?? anthropicProvider,
      gemini: opts.adapters?.gemini ?? geminiProvider,
    };
  }

  /**
   * Try each configured provider in priority order. Yields the first one
   * that produces a token. See module docstring for the full state machine.
   */
  async *stream(req: ChatStreamRequest): AsyncIterable<ChatStreamChunk> {
    const order = this.opts.order ?? envOrder() ?? DEFAULT_ORDER;
    const mockOnly = this.opts.mockOnly ?? envMockOnly();

    if (mockOnly) {
      yield* this.adapters.mock.stream(req);
      return;
    }

    const configured = order
      .map((name) => this.adapters[name])
      .filter((a) => a.isConfigured());

    if (configured.length === 0) {
      // Strict mode (MOCK_PROVIDER=false + zero keys) — explicit failure
      // beats silent mock fallback, so operators know to add keys.
      throw new ProviderError(
        'no_providers_configured',
        'MOCK_PROVIDER=false but no provider API keys are configured',
      );
    }

    for (let i = 0; i < configured.length; i++) {
      const adapter = configured[i];
      if (!adapter) continue;
      const tried = await tryStreamUntilFirstToken(adapter, req);
      if (tried.kind === 'committed') {
        yield* tried.stream;
        return;
      }
      // Pre-first-token failure — log and try the next provider.
      // eslint-disable-next-line no-console
      console.warn(
        `[@argus/sdk] provider ${adapter.name} failed before first token (${tried.error.code}); trying next`,
      );
    }

    // All configured real providers failed pre-token. Last-resort mock.
    // eslint-disable-next-line no-console
    console.warn('[@argus/sdk] all configured providers failed before first token — falling back to mock');
    yield* this.adapters.mock.stream(req);
  }
}

/**
 * Drive the adapter's iterator just far enough to observe the first
 * meaningful yield. If we get a `token` or a `done` chunk, the adapter is
 * committed and we return a wrapper iterable that re-emits the buffered
 * chunk(s) and then continues consuming the underlying iterator. If we get
 * a ProviderError BEFORE any yield, return it for the router to inspect.
 *
 * Why drive it to first yield rather than just calling .stream(): some
 * adapters perform the pre-flight HTTP call inside the async generator (it's
 * the natural place for it). The error doesn't surface until the consumer
 * awaits the first `.next()`.
 */
async function tryStreamUntilFirstToken(
  adapter: ProviderAdapter,
  req: ChatStreamRequest,
): Promise<
  | { kind: 'committed'; stream: AsyncIterable<ChatStreamChunk> }
  | { kind: 'pre_token_error'; error: ProviderError }
> {
  const iter = adapter.stream(req)[Symbol.asyncIterator]();
  let first: IteratorResult<ChatStreamChunk>;
  try {
    first = await iter.next();
  } catch (err) {
    return { kind: 'pre_token_error', error: toProviderError(err) };
  }
  if (first.done) {
    // Adapter produced ZERO chunks and ended cleanly. Treat as a soft
    // failure and try the next provider — an empty stream is not a useful
    // response.
    return {
      kind: 'pre_token_error',
      error: new ProviderError('empty_stream', `${adapter.name} produced no tokens`),
    };
  }

  const buffered = first.value;
  const wrapped: AsyncIterable<ChatStreamChunk> = {
    [Symbol.asyncIterator]() {
      let emittedFirst = false;
      return {
        async next(): Promise<IteratorResult<ChatStreamChunk>> {
          if (!emittedFirst) {
            emittedFirst = true;
            return { value: buffered, done: false };
          }
          return iter.next();
        },
        async return(value?: ChatStreamChunk): Promise<IteratorResult<ChatStreamChunk>> {
          if (typeof iter.return === 'function') {
            return iter.return(value);
          }
          return { value: undefined as unknown as ChatStreamChunk, done: true };
        },
      };
    },
  };
  return { kind: 'committed', stream: wrapped };
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Error) return new ProviderError('provider_error', err.message);
  return new ProviderError('provider_error', 'Unknown provider error');
}

function envMockOnly(): boolean {
  const raw = process.env.MOCK_PROVIDER;
  // Default true (keyless dev). Only explicit 'false' opts in to real routing.
  if (raw === undefined) return true;
  return raw.toLowerCase() !== 'false';
}

function envOrder(): ProviderName[] | undefined {
  const raw = process.env.PROVIDER_ORDER;
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => s.trim().toLowerCase());
  const valid: ProviderName[] = [];
  for (const p of parts) {
    if (p === 'openai' || p === 'anthropic' || p === 'gemini' || p === 'mock') {
      valid.push(p);
    }
  }
  return valid.length > 0 ? valid : undefined;
}

/** Default router shared by the top-level `chat.stream`. */
export const defaultRouter = new ProviderRouter();
