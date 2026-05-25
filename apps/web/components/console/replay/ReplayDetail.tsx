// ReplayDetail — two-column `.replay-cmp` layout for the Replay tab
// (LLD Phase 9 / Task 177). Reskinned to the dev-tool design language
// (REVIEW-BRIEF Finding 4).
//
// Renders `.replay-col` ORIGINAL (left) and `.replay-col` REPLAY (right).
// Each column has:
//   - `.colhd` — label + provider·model tag
//   - `.metrics` — latency / tokens p·c / cost with delta on the replay side
//   - `.output` — input box (original only) + word-level diff output
//
// The DiffToggle is preserved above the columns when a result is present.
// ReplayErrorMessage renders below both columns on failure.
// "Too large to diff" fallback note is preserved.
//
// All pre-existing data-testids and ARIA attributes are preserved exactly.

'use client';

import type {
  InferenceStatus,
  ProviderAvailabilityResponse,
  ReplayRunResponse,
} from '@argus/contracts';

import { DiffToggle, type DiffViewMode } from './DiffToggle';
import { SideBySidePane } from './SideBySidePane';
import { ReplayErrorMessage, type ReplayFailureKind } from './ReplayErrorMessage';

export type ReplaySource = {
  id: string;
  provider: string;
  model: string;
  conversationTitle: string | null;
  inputPreview: string | null;
  status: InferenceStatus;
  outputPreview?: string | null;
  // Metrics present when loaded from ReplayDetail endpoint:
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalCostMicros?: number | null;
};

export type ReplayRunState = 'idle' | 'running' | 'success' | 'failed';

export type ReplayDetailProps = {
  source: ReplaySource;
  availability: ProviderAvailabilityResponse;
  provider: string;
  model: string;
  onProviderModelChange: (provider: string, model: string) => void;
  onRun: () => void;
  onReset: () => void;
  runState: ReplayRunState;
  result: ReplayRunResponse | null;
  mode: DiffViewMode;
  onModeChange: (mode: DiffViewMode) => void;
  errorKind?: ReplayFailureKind;
  errorCause?: string;
};

// --------------------------------------------------------------------------
// Formatters
// --------------------------------------------------------------------------
function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function fmtTok(n: number | null | undefined): string {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtUSD(micros: number | null | undefined): string {
  if (micros == null) return '—';
  const usd = micros / 1_000_000;
  if (usd < 0.0001) return '<$0.0001';
  return `$${usd.toFixed(4)}`;
}

function diffChanges(result: ReplayRunResponse | null) {
  if (result?.diff && 'changes' in result.diff) return result.diff.changes;
  return [];
}

// --------------------------------------------------------------------------
// ReplayDetail
// --------------------------------------------------------------------------
export function ReplayDetail({
  source,
  availability: _availability,
  provider: _provider,
  model: _model,
  onProviderModelChange: _onProviderModelChange,
  onRun: _onRun,
  onReset: _onReset,
  runState,
  result,
  mode,
  onModeChange,
  errorKind,
  errorCause,
}: ReplayDetailProps) {
  const tooLarge = result?.diff != null && 'tooLarge' in result.diff;

  // Replay result metrics — ReplayRunResponse does not expose latency/tokens
  // directly; the diff is the core payload. We surface what we have.
  // latencyMs / token deltas are shown if present in the result extension.
  const replayLatencyMs = (result as Record<string, unknown> | null)?.['latencyMs'] as
    | number
    | undefined;
  const replayPromptTokens = (result as Record<string, unknown> | null)?.['promptTokens'] as
    | number
    | undefined;
  const replayCompletionTokens = (result as Record<string, unknown> | null)?.[
    'completionTokens'
  ] as number | undefined;
  const replayCostMicros = (result as Record<string, unknown> | null)?.['totalCostMicros'] as
    | number
    | undefined;

  const latDelta =
    replayLatencyMs != null && source.latencyMs != null
      ? replayLatencyMs - source.latencyMs
      : null;
  const costDelta =
    replayCostMicros != null && source.totalCostMicros != null
      ? replayCostMicros - source.totalCostMicros
      : null;

  // Replay provider·model from result extension, fall back to result fields.
  const replayProvider = (result as Record<string, unknown> | null)?.['provider'] as
    | string
    | undefined;
  const replayModel = (result as Record<string, unknown> | null)?.['model'] as string | undefined;

  return (
    <div data-testid="console-replay-detail" className="replay-cmp">
      {/* ---- ORIGINAL column ------------------------------------------------ */}
      <div
        data-testid="console-replay-col-original"
        className="replay-col"
      >
        {/* Column header */}
        <div className="colhd">
          <div className="lab">original</div>
          <div className="now" aria-label={`Original: ${source.provider} · ${source.model}`}>
            <span className="ptag" data-prov={source.provider}>
              <span className="swatch" aria-hidden="true" />
              {source.provider}
            </span>
            {' · '}
            <span style={{ color: 'var(--con-dim)', fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}>
              {source.model}
            </span>
          </div>
        </div>

        {/* Metrics row */}
        <div className="metrics" data-testid="console-replay-metrics-original">
          <div className="metric">
            <div className="ml">latency</div>
            <div className="mv" data-testid="console-replay-metric-original-latency">
              {fmtMs(source.latencyMs)}
            </div>
          </div>
          <div className="metric">
            <div className="ml">tokens p / c</div>
            <div
              className="mv"
              style={{ fontSize: 14 }}
              data-testid="console-replay-metric-original-tokens"
            >
              {fmtTok(source.promptTokens)} / {fmtTok(source.completionTokens)}
            </div>
          </div>
          <div className="metric">
            <div className="ml">cost</div>
            <div className="mv" data-testid="console-replay-metric-original-cost">
              {fmtUSD(source.totalCostMicros)}
            </div>
          </div>
        </div>

        {/* Output area — input box then word-diff (original side = deletions) */}
        <div className="output" data-testid="console-replay-output-original">
          <div
            style={{
              color: 'var(--con-dim-2)',
              fontSize: 10.5,
              marginBottom: 8,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            input
          </div>
          <div
            data-testid="console-replay-input-preview"
            style={{
              color: 'var(--con-dim)',
              marginBottom: 14,
              padding: '8px 10px',
              background: 'oklch(0.21 0.008 270)',
              borderRadius: 4,
              border: '1px solid var(--con-rule)',
            }}
          >
            {source.inputPreview ?? '—'}
          </div>
          <div
            style={{
              color: 'var(--con-dim-2)',
              fontSize: 10.5,
              marginBottom: 8,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            output
          </div>
          {/* Original side of the diff: show deletions (text in original not in replay) */}
          {runState === 'success' && result && !tooLarge ? (
            <OriginalDiff changes={diffChanges(result)} />
          ) : (
            <div
              data-testid="console-replay-original-output-text"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {source.outputPreview ?? '—'}
            </div>
          )}
        </div>
      </div>

      {/* ---- REPLAY column -------------------------------------------------- */}
      <div
        data-testid="console-replay-col-replay"
        className="replay-col"
      >
        {/* Column header */}
        <div className="colhd">
          <div className="lab">replay</div>
          <div className="now">
            {runState === 'success' || runState === 'running' ? (
              <>
                <span className="ptag" data-prov={replayProvider ?? _provider}>
                  <span className="swatch" aria-hidden="true" />
                  {replayProvider ?? _provider}
                </span>
                {' · '}
                <span
                  style={{
                    color: 'var(--con-dim)',
                    fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                  }}
                >
                  {replayModel ?? _model}
                </span>
                {runState === 'running' && (
                  <span
                    style={{
                      color: 'var(--info)',
                      marginLeft: 8,
                      fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                    }}
                    aria-live="polite"
                  >
                    · streaming
                  </span>
                )}
              </>
            ) : (
              <span
                style={{
                  fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                  color: 'var(--con-dim-2)',
                }}
                aria-label="Replay idle"
              >
                idle
              </span>
            )}
          </div>
        </div>

        {/* Metrics row with deltas */}
        <div className="metrics" data-testid="console-replay-metrics-replay">
          <div className="metric">
            <div className="ml">latency</div>
            <div className="mv" data-testid="console-replay-metric-replay-latency">
              {replayLatencyMs != null ? fmtMs(replayLatencyMs) : '—'}
            </div>
            {latDelta != null && runState === 'success' && (
              <div
                className={`delta ${latDelta > 0 ? 'up' : 'down'}`}
                data-testid="console-replay-metric-latency-delta"
              >
                {latDelta > 0 ? '+' : ''}
                {latDelta}ms vs original
              </div>
            )}
          </div>
          <div className="metric">
            <div className="ml">tokens p / c</div>
            <div
              className="mv"
              style={{ fontSize: 14 }}
              data-testid="console-replay-metric-replay-tokens"
            >
              {replayPromptTokens != null
                ? `${fmtTok(replayPromptTokens)} / ${fmtTok(replayCompletionTokens)}`
                : '—'}
            </div>
          </div>
          <div className="metric">
            <div className="ml">cost</div>
            <div className="mv" data-testid="console-replay-metric-replay-cost">
              {replayCostMicros != null ? fmtUSD(replayCostMicros) : '—'}
            </div>
            {costDelta != null && runState === 'success' && (
              <div
                className={`delta ${costDelta > 0 ? 'up' : 'down'}`}
                data-testid="console-replay-metric-cost-delta"
              >
                {costDelta >= 0 ? '+' : ''}
                {fmtUSD(Math.abs(costDelta))} vs original
              </div>
            )}
          </div>
        </div>

        {/* Output area — replay insertions + pending/error states */}
        <div className="output" data-testid="console-replay-output-replay">
          <div
            style={{
              color: 'var(--con-dim-2)',
              fontSize: 10.5,
              marginBottom: 8,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            output{runState === 'running' && ' · streaming'}
          </div>

          {runState === 'idle' && (
            <div
              className="pending"
              data-testid="console-replay-pending"
              aria-live="polite"
            >
              Hit &ldquo;Run replay&rdquo; to send this input to the selected provider.
            </div>
          )}

          {runState === 'running' && (
            <div
              className="pending"
              data-testid="console-replay-running"
              aria-live="polite"
            >
              Replaying…
            </div>
          )}

          {runState === 'success' && result && !tooLarge && (
            <ReplayDiff changes={diffChanges(result)} />
          )}

          {runState === 'success' && tooLarge && (
            <p
              data-testid="console-replay-too-large"
              style={{ color: 'var(--con-dim-2)', fontStyle: 'italic' }}
            >
              Outputs too large to diff — open each in chat to compare.
            </p>
          )}

          {runState === 'failed' && (
            <ReplayErrorMessage kind={errorKind ?? 'replay_failed'} cause={errorCause} />
          )}
        </div>
      </div>

      {/* ---- Diff toggle + side-by-side (accessible full view) --------------- */}
      {/* The SideBySidePane provides the pane-expand modal and full diff view.
          Rendered off-screen but accessible: the toggle lives in an overlay
          controlled by the DiffToggle. We surface it as a collapsible region
          below the two columns so keyboard/screen-reader users can access it. */}
      {(runState === 'success' || runState === 'failed') && (
        <div
          data-testid="console-replay-side-by-side-wrapper"
          style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--con-rule)' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              padding: '8px 18px',
              borderBottom: '1px solid var(--con-rule)',
            }}
          >
            <DiffToggle mode={mode} onChange={onModeChange} />
          </div>

          {runState === 'success' && result && !tooLarge && (
            <SideBySidePane
              original={source.outputPreview ?? '(no original output captured)'}
              replay="Replay complete — see diff above."
              diff={diffChanges(result)}
              mode={mode}
            />
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Inline diff sub-renderers using the CSS `.output del` / `.output ins` rules
// --------------------------------------------------------------------------

import type { DiffChange } from '@argus/contracts';

/** Original side: show text that is being removed (deletions highlighted). */
function OriginalDiff({ changes }: { changes: DiffChange[] }) {
  return (
    <div
      data-testid="console-replay-original-diff"
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {changes.map((c, i) => {
        if (c.added) return null; // insertions belong to the replay side
        if (c.removed) return <del key={i}>{c.value}</del>;
        return <span key={i}>{c.value}</span>;
      })}
    </div>
  );
}

/** Replay side: show text that is being inserted (additions highlighted). */
function ReplayDiff({ changes }: { changes: DiffChange[] }) {
  return (
    <div
      data-testid="console-replay-replay-diff"
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {changes.map((c, i) => {
        if (c.removed) return null; // deletions shown on the original side
        if (c.added) return <ins key={i}>{c.value}</ins>;
        return <span key={i}>{c.value}</span>;
      })}
    </div>
  );
}
