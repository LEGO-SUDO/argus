// replayEligibility — pure predicate mapping a source inference's status to
// whether it can be replayed (PRD source-status matrix).
//
//   ok | failed | timed_out  -> eligible
//   canceled                 -> eligible_with_warning (partial captured input)
//   streaming (or anything    -> ineligible (no terminal input to reconstruct)
//   unrecognized)
import type { ReplayEligibility } from '@argus/contracts';

export function replayEligibility(status: string): ReplayEligibility {
  switch (status) {
    case 'ok':
    case 'failed':
    case 'timed_out':
      return 'eligible';
    case 'canceled':
      return 'eligible_with_warning';
    case 'streaming':
      return 'ineligible';
    default:
      return 'ineligible';
  }
}
