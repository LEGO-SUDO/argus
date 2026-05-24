// Provider router — priority list with pre-first-token failover.
//
// Selection (default — no pin):
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
//
// Override branch (chat-context-and-ux-polish LLD Tasks 31/32):
//   If `req.pin` is set, the failover loop is OFF — we use the named
//   adapter exclusively. Failure surfaces as `pinned_provider_unavailable`
//   (the original error code is preserved in the message). Mock-only env
//   short-circuit (#1) still beats the override branch so operators on the
//   keyless path keep their predictable mock behavior.
//
// Synthetic `commit` chunk (chat-context-and-ux-polish LLD Tasks 27-30):
//   The committed-stream wrapper drops a synthetic `commit` chunk in front
//   of the first NON-EMPTY token. Provider = the chosen adapter's `name`;
//   model = the request's pinned model when present, else the adapter's
//   primary catalog entry (`listModels()[0]`). The wrapper guards
//   exactly-once even if the helper is invoked twice. Leading zero-length
//   token chunks do NOT trigger commit — we drive the iterator one more
//   step until a real token (or done) arrives, then commit + emit.

import type { ProviderAdapter, ProviderName } from './providers/types';
import type { ChatStreamChunk, ChatStreamRequest, ProviderMeta } from './index';
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
      // mockOnly wins over a pin — same precedence the docstring spells out.
      // Wrap with commit emission so the orchestrator gets a metadata frame
      // even on the keyless dev path.
      yield* wrapCommitted(this.adapters.mock, req);
      return;
    }

    // chat-context-and-ux-polish LLD Task 32 — override branch. If the pin
    // is set we use the named adapter exclusively; no failover.
    if (req.pin) {
      yield* this.streamPinned(req);
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
        yield* wrapCommittedFromBuffered(adapter, req, tried.buffered, tried.iter);
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
    yield* wrapCommitted(this.adapters.mock, req);
  }

  private async *streamPinned(req: ChatStreamRequest): AsyncIterable<ChatStreamChunk> {
    const pin = req.pin!;
    const adapter = (this.adapters as Record<string, ProviderAdapter | undefined>)[pin.provider];
    if (!adapter || !adapter.isConfigured()) {
      // No adapter, or not configured at all → fail the request. Do not
      // silently downgrade to another provider; that would be a footgun for
      // anyone who pinned for cost-control or compliance reasons.
      throw new ProviderError(
        'pinned_provider_unavailable',
        `pinned provider ${pin.provider} is not configured`,
      );
    }
    // The pinned adapter handles the entire request. Re-wrap any pre-token
    // failure as `pinned_provider_unavailable` so the gateway/orchestrator
    // can surface a stable error code on the WS error frame; original code
    // preserved in the message.
    const tried = await tryStreamUntilFirstToken(adapter, req);
    if (tried.kind === 'pre_token_error') {
      throw new ProviderError(
        'pinned_provider_unavailable',
        `pinned provider ${pin.provider} failed before first token (${tried.error.code}): ${tried.error.message}`,
      );
    }
    yield* wrapCommittedFromBuffered(adapter, req, tried.buffered, tried.iter);
  }
}

/**
 * Drive the adapter's iterator just far enough to observe the first
 * meaningful yield. If we get a `token` or a `done` chunk, the adapter is
 * committed and we return the buffered chunk + the live iterator for the
 * caller to wrap with commit emission. If we get a ProviderError BEFORE any
 * yield, return it for the router to inspect.
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
  | {
      kind: 'committed';
      buffered: ChatStreamChunk;
      iter: AsyncIterator<ChatStreamChunk>;
    }
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
  return { kind: 'committed', buffered: first.value, iter };
}

/**
 * Wrap a fresh adapter call with `commit`-chunk emission. Used by the
 * mockOnly + last-resort-mock paths that bypass `tryStreamUntilFirstToken`.
 */
async function* wrapCommitted(
  adapter: ProviderAdapter,
  req: ChatStreamRequest,
): AsyncIterable<ChatStreamChunk> {
  const tried = await tryStreamUntilFirstToken(adapter, req);
  if (tried.kind === 'pre_token_error') {
    // The mockOnly path picked mock; mock never throws pre-token in practice,
    // but if it did we surface as-is (no failover from here).
    throw tried.error;
  }
  yield* wrapCommittedFromBuffered(adapter, req, tried.buffered, tried.iter);
}

/**
 * Re-emit a buffered first chunk followed by the rest of the iterator,
 * prepending a synthetic `commit` chunk immediately before the first
 * NON-EMPTY token (LLD Task 28). The commit emission is single-shot —
 * a defensive guard ensures duplicate calls inside this wrapper never
 * produce a second commit chunk (LLD Task 30, Preamble §2).
 *
 * chat-context-and-ux-polish (Codex review wire-protocol fix):
 *   - Leading zero-length token chunks are SUPPRESSED entirely until the
 *     commit fires. Forwarding them would ship as WS `token@1` and then
 *     metadata wants seq=1 — duplicate seq + metadata-after-token both
 *     violate the per-message frame ordering (LLD Preamble §2). Once the
 *     commit fires, subsequent zero-length tokens are coalesced (dropped)
 *     defensively too — adapters don't normally yield empty tokens mid-
 *     stream and a leaked one only inflates the seq counter.
 *   - If the buffered chunk is a zero-length token, we drain forward one
 *     chunk at a time until a non-empty token (or a `done`) lands.
 */
async function* wrapCommittedFromBuffered(
  adapter: ProviderAdapter,
  req: ChatStreamRequest,
  buffered: ChatStreamChunk,
  iter: AsyncIterator<ChatStreamChunk>,
): AsyncIterable<ChatStreamChunk> {
  let committed = false;
  const emitCommit = (): ChatStreamChunk | null => {
    // LLD Task 30 — exactly-once guard. Subsequent calls return null so the
    // caller doesn't yield a second commit chunk into the stream.
    if (committed) return null;
    committed = true;
    return makeCommitChunk(adapter, req);
  };

  // Drain the buffered chunk first, then continue with the iterator. We
  // gate commit emission on the first NON-EMPTY token; zero-length tokens
  // before commit are dropped, and zero-length tokens after commit are
  // also coalesced defensively.
  let current: ChatStreamChunk | null = buffered;
  let done = false;
  while (!done) {
    if (current !== null) {
      if (current.type === 'token' && current.content.length > 0) {
        const commit = emitCommit();
        if (commit) yield commit;
        yield current;
      } else if (current.type === 'token') {
        // Zero-length token — DROP entirely. Pre-commit forwarding would
        // collide with metadata's seq=1; post-commit forwarding would just
        // inflate the seq counter for no UI value. Either way: nothing to
        // emit.
      } else if (current.type === 'done') {
        // Stream ending without any non-empty token; emit commit if we
        // haven't (defensive — the orchestrator can render an immediate
        // empty completion) then re-emit done. Note: if the adapter ended
        // cleanly without ever yielding a token, the router never reaches
        // this wrapper (tryStreamUntilFirstToken surfaces empty_stream),
        // so this branch is the rare "yields one chunk and it was done"
        // case which the caller still needs to handle. Emit commit so the
        // orchestrator's metadata frame ships with the right provider/model.
        const commit = emitCommit();
        if (commit) yield commit;
        yield current;
      } else {
        // type === 'commit' — adapters shouldn't emit this themselves; if
        // they do, treat it as already-committed and just forward.
        committed = true;
        yield current;
      }
    }
    const next = await iter.next();
    if (next.done) {
      done = true;
    } else {
      current = next.value;
    }
  }
}

function makeCommitChunk(adapter: ProviderAdapter, req: ChatStreamRequest): ChatStreamChunk {
  // Model: pinned model if present (override branch), else the adapter's
  // primary catalog entry (`listModels()[0]`). This is the SDK's last word
  // on the metadata before any token reaches the wire (LLD Preamble §1).
  const model = req.pin?.model ?? adapter.listModels()[0] ?? 'unknown';
  const meta: ProviderMeta = {
    provider: adapter.name,
    model,
  };
  return { type: 'commit', providerMeta: meta };
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
