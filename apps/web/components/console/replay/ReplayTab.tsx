// ReplayTab — orchestrates the Replay tab (LLD Tasks 164-169 + Task 177 shell).
//
// Routes between the candidate picker (no source selected) and the detail view
// (source selected), owns the target provider/model selection + diff view mode,
// and drives the replay-run state machine (idle -> running -> success | failed)
// off console-api.runReplay.

'use client';

import { useState } from 'react';

import type {
  ProviderAvailabilityResponse,
  ReplayCandidate,
  ReplayDetail as ReplayDetailDto,
  ReplayRunResponse,
  TimeWindow,
} from '@argus/contracts';
import { runReplay } from '@/lib/console-api';
import { ApiError } from '@/lib/auth-fetch';

import { ReplayPicker } from './ReplayPicker';
import { ReplayDetail, type ReplayRunState, type ReplaySource } from './ReplayDetail';
import type { DiffViewMode } from './DiffToggle';
import type { ReplayFailureKind } from './ReplayErrorMessage';

export type ReplayTabProps = {
  candidates: ReplayCandidate[];
  /** Present when the page was opened with ?source=<inferenceId>. */
  initialDetail?: ReplayDetailDto;
  availability: ProviderAvailabilityResponse;
  window: TimeWindow;
};

function toSource(input: ReplayCandidate | ReplayDetailDto): ReplaySource {
  return {
    id: input.id,
    provider: input.provider,
    model: input.model,
    conversationTitle: input.conversationTitle,
    inputPreview: input.inputPreview,
    status: input.status,
    outputPreview: 'outputPreview' in input ? input.outputPreview : null,
  };
}

export function ReplayTab({ candidates, initialDetail, availability, window }: ReplayTabProps) {
  const initialSource = initialDetail ? toSource(initialDetail) : null;

  const [source, setSource] = useState<ReplaySource | null>(initialSource);
  const [provider, setProvider] = useState(initialSource?.provider ?? '');
  const [model, setModel] = useState(initialSource?.model ?? '');
  const [mode, setMode] = useState<DiffViewMode>('diff');
  const [runState, setRunState] = useState<ReplayRunState>('idle');
  const [result, setResult] = useState<ReplayRunResponse | null>(null);
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
      const response = await runReplay({ sourceInferenceId: source.id, provider, model });
      setResult(response);
      setRunState('success');
    } catch (err) {
      // A canceled original has no output to compare; otherwise the replay
      // itself failed.
      setErrorKind(source.status === 'canceled' ? 'original_canceled' : 'replay_failed');
      setErrorCause(
        err instanceof ApiError || err instanceof Error ? err.message : 'unknown error',
      );
      setRunState('failed');
    }
  };

  if (!source) {
    return (
      <div data-testid="console-replay-tab">
        <h1 className="sr-only">Replay</h1>
        <ReplayPicker candidates={candidates} window={window} onSelect={selectCandidate} />
      </div>
    );
  }

  return (
    <div data-testid="console-replay-tab">
      <h1 className="sr-only">Replay</h1>
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
