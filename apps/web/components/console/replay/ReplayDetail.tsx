// ReplayDetail — the detail view for a selected replay source (LLD Phase 9 /
// Task 177). Presentational: ReplayTab owns the provider/model + run state and
// passes them in. Renders the original metadata, the provider/model picker, the
// run + reset controls, the diff toggle, and (on success) the side-by-side
// pane or (on failure) the error message.

'use client';

import type {
  InferenceStatus,
  ProviderAvailabilityResponse,
  ReplayRunResponse,
} from '@argus/contracts';

import { ProviderModelPicker } from './ProviderModelPicker';
import { RunReplayButton } from './RunReplayButton';
import { ResetToOriginalButton } from './ResetToOriginalButton';
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

function diffChanges(result: ReplayRunResponse | null) {
  if (result?.diff && 'changes' in result.diff) return result.diff.changes;
  return [];
}

export function ReplayDetail({
  source,
  availability,
  provider,
  model,
  onProviderModelChange,
  onRun,
  onReset,
  runState,
  result,
  mode,
  onModeChange,
  errorKind,
  errorCause,
}: ReplayDetailProps) {
  const tooLarge = result?.diff != null && 'tooLarge' in result.diff;

  return (
    <div data-testid="console-replay-detail" className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2 rounded-md border border-chat-rule bg-chat-panel p-3 text-[12.5px]">
        <div className="col-span-2 flex justify-between">
          <dt className="text-chat-ink-3">Original</dt>
          <dd className="font-medium text-chat-ink">
            {source.provider} · {source.model}
          </dd>
        </div>
        <div className="col-span-2 flex justify-between">
          <dt className="text-chat-ink-3">Conversation</dt>
          <dd className="text-chat-ink-2">{source.conversationTitle ?? 'Untitled conversation'}</dd>
        </div>
        {source.inputPreview && (
          <p className="col-span-2 truncate text-chat-ink-2">{source.inputPreview}</p>
        )}
      </dl>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <ProviderModelPicker
          availability={availability}
          provider={provider}
          model={model}
          onChange={onProviderModelChange}
        />
        <div className="flex items-center gap-2">
          <ResetToOriginalButton onReset={onReset} />
          <RunReplayButton onRun={onRun} running={runState === 'running'} />
        </div>
      </div>

      {(runState === 'success' || runState === 'failed') && (
        <div className="flex items-center justify-end">
          <DiffToggle mode={mode} onChange={onModeChange} />
        </div>
      )}

      {runState === 'success' && result && !tooLarge && (
        <SideBySidePane
          original={source.outputPreview ?? '(no original output captured)'}
          replay="Replay streamed into chat — compare via the diff view."
          diff={diffChanges(result)}
          mode={mode}
        />
      )}
      {runState === 'success' && tooLarge && (
        <p data-testid="console-replay-too-large" className="text-[12.5px] text-chat-ink-2">
          Outputs too large to diff — open each in chat to compare.
        </p>
      )}
      {runState === 'failed' && (
        <ReplayErrorMessage kind={errorKind ?? 'replay_failed'} cause={errorCause} />
      )}
    </div>
  );
}
