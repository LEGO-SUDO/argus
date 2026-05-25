// ReplayErrorMessage — inline failure copy for the replay pane (LLD Tasks
// 158-159). Distinct copy per failure kind; pure render.

'use client';

export type ReplayFailureKind = 'original_canceled' | 'replay_failed' | 'both_failed';

export type ReplayErrorMessageProps = {
  kind: ReplayFailureKind;
  /** Underlying cause, embedded into the `replay_failed` copy. */
  cause?: string;
};

export function ReplayErrorMessage({ kind, cause }: ReplayErrorMessageProps) {
  let message: string;
  switch (kind) {
    case 'original_canceled':
      message = 'Original was canceled — no output to compare.';
      break;
    case 'replay_failed':
      message = `Replay failed${cause ? `: ${cause}` : ''}.`;
      break;
    case 'both_failed':
    default:
      message = 'Both the original and the replay failed — nothing to compare.';
      break;
  }

  return (
    <p
      data-testid="console-replay-error"
      data-kind={kind}
      role="alert"
      className="rounded-md border border-err px-3 py-2 text-[12.5px] text-err"
    >
      {message}
    </p>
  );
}
