// FailoverChain — inline expansion content for a trace row, showing one row
// per failover attempt with the user-message preview above (LLD Tasks 114-117).
//
// Pure render. The last-row summary reflects the final attempt's status:
// a terminal `ok` means the turn "succeeded after N retries"; otherwise "all
// attempts failed".
//
// NOTE (contract reconciliation): the authored `TraceRowSchema` does not carry
// a per-attempt failover array, so the attempts are passed in as a prop. The
// composition layer supplies whatever attempt data is available; when none is,
// the row simply shows no expansion. Flagged for a follow-up contract field.

'use client';

import type { InferenceStatus } from '@argus/contracts';

export type FailoverAttempt = {
  provider: string;
  model: string;
  status: InferenceStatus;
  errorCode?: string | null;
};

export type FailoverChainProps = {
  attempts: FailoverAttempt[];
  userMessagePreview?: string;
};

export function FailoverChain({ attempts, userMessagePreview }: FailoverChainProps) {
  const last = attempts.at(-1);
  const succeeded = last?.status === 'ok';
  const retries = Math.max(0, attempts.length - 1);
  const summary = succeeded
    ? `Succeeded after ${retries} ${retries === 1 ? 'retry' : 'retries'}`
    : 'All attempts failed';

  return (
    <div data-testid="console-failover-chain" className="flex flex-col gap-2 text-[12.5px]">
      {userMessagePreview && (
        <p
          data-testid="console-failover-chain-preview"
          className="rounded-md bg-con-panel px-2.5 py-1.5 text-con-dim"
        >
          {userMessagePreview}
        </p>
      )}
      <ol className="flex flex-col gap-1">
        {attempts.map((attempt, index) => (
          <li
            key={`${attempt.provider}-${attempt.model}-${index}`}
            data-testid={`console-failover-attempt-${index}`}
            className="flex items-center justify-between rounded-md border border-con-rule px-2.5 py-1.5"
          >
            <span className="text-con-text">
              {attempt.provider} · {attempt.model}
            </span>
            <span className="text-con-dim" data-status={attempt.status}>
              {attempt.status}
              {attempt.errorCode ? ` (${attempt.errorCode})` : ''}
            </span>
          </li>
        ))}
      </ol>
      <p
        data-testid="console-failover-chain-summary"
        className={succeeded ? 'text-ok' : 'text-err'}
      >
        {summary}
      </p>
    </div>
  );
}
