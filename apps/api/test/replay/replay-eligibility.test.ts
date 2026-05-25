import { replayEligibility } from '../../src/replay/replay-eligibility';

describe('replayEligibility', () => {
  it('maps the source-status matrix per PRD', () => {
    expect(replayEligibility('ok')).toBe('eligible');
    expect(replayEligibility('failed')).toBe('eligible');
    expect(replayEligibility('timed_out')).toBe('eligible');
    expect(replayEligibility('canceled')).toBe('eligible_with_warning');
    expect(replayEligibility('streaming')).toBe('ineligible');
    expect(replayEligibility('weird-unknown')).toBe('ineligible');
  });
});
