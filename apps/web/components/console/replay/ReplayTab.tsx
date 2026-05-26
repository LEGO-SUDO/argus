// ReplayTab — orchestrates the Replay tab (LLD Tasks 164-169 + Task 177 shell).
//
// Reskinned to the dev-tool design language (REVIEW-BRIEF Finding 4).
// When a source is selected: renders `.replay-shell` with a `.replay-picker`
// toolbar (source chip, arrow, target-pick provider buttons, run-btn) and a
// `.replay-cmp` two-column side-by-side comparison. When no source is
// selected: renders the `.replay-picker` candidate dropdown (SourceMenu via
// ReplayPicker).
//
// Run lifecycle: idle → running → success | failed. All data-testids and
// accessibility attributes are preserved from the original implementation.

'use client';

import { useState } from 'react';

import type {
  ProviderAvailabilityResponse,
  ReplayCandidate,
  ReplayDetail as ReplayDetailDto,
  TimeWindow,
} from '@argus/contracts';
import { fetchReplayDetail, runReplay } from '@/lib/console-api';
import { ApiError } from '@/lib/auth-fetch';

import { EmptyState } from '@/components/console/EmptyState';
import { ReplayPicker } from './ReplayPicker';
import { ReplayPickerBar } from './ReplayPickerBar';
import { ReplayDetail, type ReplayRunState, type ReplaySource } from './ReplayDetail';
import type { DiffViewMode } from './DiffToggle';
import type { ReplayFailureKind } from './ReplayErrorMessage';

export type ReplayTabProps = {
  candidates: ReplayCandidate[];
  /** Present when the page was opened with ?sourceId=<inferenceId>. */
  initialDetail?: ReplayDetailDto;
  availability: ProviderAvailabilityResponse;
  window: TimeWindow;
};

// Poll the replay detail until the server has computed the diff (the replay
// turn streams async, so the diff lands a few seconds after kickoff). The
// detail's `diff` flips from null → a value once the replay message is
// terminal. Bounded so a hung/never-finishing replay surfaces as a failure
// rather than spinning forever.
const POLL_INTERVAL_MS = 1500;
// Poll past the server-side replay cap (REPLAY_MAX_DURATION_MS ≈ 45s) so that
// even a stalled replay — which the server force-cancels at that cap, making
// the diff computable — resolves here instead of erroring. ~60 × 1.5s ≈ 90s.
const POLL_MAX_ATTEMPTS = 60;
// Once the diff lands, latency/tokens/cost come from the (slightly later) async
// projection. Wait a short grace for them, then show the diff regardless so the
// output isn't held hostage to telemetry lag.
const METRICS_GRACE_ATTEMPTS = 2; // ~3s after the diff appears
// Sustained poll failures mean the api went away mid-replay (restart/crash) —
// the run is orphaned (its orchestrator died with the process), so fail fast
// instead of polling a doomed run. A couple of transient blips are tolerated.
const MAX_CONSECUTIVE_ERRORS = 3;

async function pollReplayDetail(inferenceId: string): Promise<ReplayDetailDto> {
  let withDiff: ReplayDetailDto | null = null;
  let attemptsSinceDiff = 0;
  let consecutiveErrors = 0;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    let detail: ReplayDetailDto;
    try {
      detail = await fetchReplayDetail(inferenceId);
      consecutiveErrors = 0;
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(
          'Lost connection to the server during the replay — it may have restarted. Run it again.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    if (detail.diff !== null) {
      withDiff = detail;
      // Have the comparison. Prefer to also have metrics; stop waiting for them
      // once the grace window elapses.
      if (detail.latencyMs !== null || attemptsSinceDiff >= METRICS_GRACE_ATTEMPTS) {
        return detail;
      }
      attemptsSinceDiff += 1;
    } else if (detail.status === 'failed' || detail.status === 'canceled') {
      // Terminal inference with no computable diff — the run failed or was
      // interrupted/orphaned (e.g. swept after an api restart). Surface it
      // rather than waiting out the full window.
      throw new Error(
        'Replay did not complete — the run failed or was interrupted. Run it again.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  // No diff after the full window even though the server should have finalized
  // the turn by its own cap — almost always an interrupted/orphaned run (e.g.
  // the api restarted mid-stream). Surface a clear, actionable message.
  if (withDiff) return withDiff;
  throw new Error(
    'Replay did not finish — it may have been interrupted. Check Traces or run it again.',
  );
}

function toSource(input: ReplayCandidate | ReplayDetailDto): ReplaySource {
  // ReplayDetail carries output + metrics; a bare candidate does not. Narrow on
  // a detail-only field so the original column can show output + latency/tokens/
  // cost upfront when we have them.
  const isDetail = 'latencyMs' in input;
  return {
    id: input.id,
    provider: input.provider,
    model: input.model,
    conversationTitle: input.conversationTitle,
    inputPreview: input.inputPreview,
    status: input.status,
    outputPreview: 'outputPreview' in input ? input.outputPreview : null,
    latencyMs: isDetail ? input.latencyMs : undefined,
    promptTokens: isDetail ? input.promptTokens : undefined,
    completionTokens: isDetail ? input.completionTokens : undefined,
    totalCostMicros: isDetail ? input.totalCostMicros : undefined,
  };
}

export function ReplayTab({ candidates, initialDetail, availability, window }: ReplayTabProps) {
  const initialSource = initialDetail ? toSource(initialDetail) : null;

  const [source, setSource] = useState<ReplaySource | null>(initialSource);
  const [provider, setProvider] = useState(initialSource?.provider ?? '');
  const [model, setModel] = useState(initialSource?.model ?? '');
  const [mode, setMode] = useState<DiffViewMode>('diff');
  const [runState, setRunState] = useState<ReplayRunState>('idle');
  const [result, setResult] = useState<ReplayDetailDto | null>(null);
  const [errorKind, setErrorKind] = useState<ReplayFailureKind>('replay_failed');
  const [errorCause, setErrorCause] = useState<string | undefined>(undefined);

  const selectCandidate = (candidate: ReplayCandidate) => {
    const next = toSource(candidate);
    setSource(next);
    setProvider(next.provider);
    setModel(next.model);
    setMode('diff');
    setRunState('idle');
    setResult(null);
    // A candidate carries no output/metrics — hydrate the full detail so the
    // ORIGINAL column shows the existing output + latency/tokens/cost upfront,
    // before any replay runs. Best-effort; a failure just leaves the previews.
    void fetchReplayDetail(candidate.id)
      .then((detail) => {
        setSource((cur) => (cur && cur.id === detail.id ? toSource(detail) : cur));
      })
      .catch(() => undefined);
  };

  const resetToOriginal = () => {
    if (!source) return;
    setProvider(source.provider);
    setModel(source.model);
  };

  const handleRun = async () => {
    if (!source) return;
    setRunState('running');
    setResult(null);
    try {
      // The replay streams ASYNCHRONOUSLY — `runReplay` returns the new ids with
      // a null diff. We then poll the detail endpoint until the replay turn is
      // terminal and the server has computed the diff (output vs source). This
      // is the read-path that was previously missing, which is why "Run replay"
      // appeared to do nothing.
      const { inferenceId } = await runReplay({ sourceInferenceId: source.id, provider, model });
      const detail = await pollReplayDetail(inferenceId);
      setResult(detail);
      setRunState('success');
    } catch (err) {
      // A canceled original has no output to compare; otherwise the replay
      // itself failed (or timed out before producing output).
      setErrorKind(source.status === 'canceled' ? 'original_canceled' : 'replay_failed');
      setErrorCause(
        err instanceof ApiError || err instanceof Error ? err.message : 'unknown error',
      );
      setRunState('failed');
    }
  };

  // No candidates at all → friendly empty state.
  if (candidates.length === 0 && !source) {
    return (
      <div data-testid="console-replay-tab" className="replay-empty">
        <h1 className="sr-only">Replay</h1>
        <EmptyState scope="replay" />
      </div>
    );
  }

  // No source selected yet → show the candidate picker.
  if (!source) {
    return (
      <div data-testid="console-replay-tab">
        <h1 className="sr-only">Replay</h1>
        <ReplayPickerBar
          candidates={candidates}
          window={window}
          onSelect={selectCandidate}
        />
      </div>
    );
  }

  return (
    <div data-testid="console-replay-tab" className="replay-shell">
      <h1 className="sr-only">Replay</h1>
      {/* Top picker bar: source chip, arrow, target-pick, run-btn */}
      <ReplayPickerBar
        source={source}
        candidates={candidates}
        window={window}
        availability={availability}
        provider={provider}
        model={model}
        onSelect={selectCandidate}
        onProviderModelChange={(p, m) => {
          setProvider(p);
          setModel(m);
        }}
        onRun={handleRun}
        onReset={resetToOriginal}
        running={runState === 'running'}
      />
      {/* Side-by-side comparison panes */}
      <ReplayDetail
        source={source}
        availability={availability}
        provider={provider}
        model={model}
        onProviderModelChange={(p, m) => {
          setProvider(p);
          setModel(m);
        }}
        onRun={handleRun}
        onReset={resetToOriginal}
        runState={runState}
        result={result}
        mode={mode}
        onModeChange={setMode}
        errorKind={errorKind}
        errorCause={errorCause}
      />
    </div>
  );
}
