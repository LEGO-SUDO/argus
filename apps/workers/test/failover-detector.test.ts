// Task 8 (RED) / Task 9 (GREEN): failover-detector decision rules.
//
// Failover trigger (post-review-fix): a new attempt is appended ONLY when
//   (a) the latest existing row has status='failed', AND
//   (b) the incoming span's provider differs from that failed row.
// Otherwise the verdict is update-in-place. This prevents spurious failover
// rows when the SDK swaps provider mid-stream (no real failure to attribute
// the new attempt to).
//
// Cases:
//   (a) no existing inferences row for message_id ⇒ "insert-placeholder-missing"
//       (gateway should have inserted; treat as recoverable but log a warning)
//   (b) existing row with status=streaming + same provider ⇒ "update-in-place"
//   (c) existing row with status=failed + different provider ⇒ "insert-failover-attempt"
//   (d) existing row with status=streaming + different provider ⇒ "update-in-place"
//       (mid-stream provider switch — no real failure, enrich in place)
//   (e) existing row with status=failed + SAME provider ⇒ "update-in-place"
//       (re-delivery of the failure span itself; enrich in place)
//   (f) existing row with status=ok + different provider ⇒ "update-in-place"
//       (defensive: no prior failure, no reason to branch — overwrite stays
//        an authoritative single attempt)
import { decideInferenceWrite, type ExistingInferenceRow } from '../src/projection/failover-detector';

function row(overrides: Partial<ExistingInferenceRow> = {}): ExistingInferenceRow {
  return {
    id: 'inf-1',
    provider: 'openai',
    status: 'streaming',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('decideInferenceWrite', () => {
  it('returns insert-placeholder-missing when no row exists', () => {
    const verdict = decideInferenceWrite([], { provider: 'openai', status: 'ok' });
    expect(verdict.kind).toBe('insert-placeholder-missing');
  });

  it('returns update-in-place when latest row is streaming with same provider', () => {
    const verdict = decideInferenceWrite(
      [row({ status: 'streaming', provider: 'openai' })],
      { provider: 'openai', status: 'ok' },
    );
    expect(verdict.kind).toBe('update-in-place');
    if (verdict.kind === 'update-in-place') {
      expect(verdict.targetRowId).toBe('inf-1');
    }
  });

  it('returns insert-failover-attempt when latest row is failed and incoming provider differs', () => {
    const verdict = decideInferenceWrite(
      [row({ status: 'failed', provider: 'openai' })],
      { provider: 'anthropic', status: 'ok' },
    );
    expect(verdict.kind).toBe('insert-failover-attempt');
  });

  it('returns update-in-place when latest row is streaming and matches by provider, ignoring older failed attempts', () => {
    const older = row({
      id: 'inf-older',
      status: 'failed',
      provider: 'openai',
      startedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const latest = row({
      id: 'inf-latest',
      status: 'streaming',
      provider: 'anthropic',
      startedAt: new Date('2026-01-01T00:00:05Z'),
    });
    const verdict = decideInferenceWrite([older, latest], {
      provider: 'anthropic',
      status: 'ok',
    });
    expect(verdict.kind).toBe('update-in-place');
    if (verdict.kind === 'update-in-place') {
      expect(verdict.targetRowId).toBe('inf-latest');
    }
  });

  it('returns update-in-place (not failover) when latest is streaming but provider mismatches (mid-stream switch, no real failure)', () => {
    // Post-review-fix behavior: a mid-stream provider switch is NOT a
    // failover unless the prior row actually failed. The streaming
    // placeholder gets enriched in place.
    const verdict = decideInferenceWrite(
      [row({ id: 'inf-stream', status: 'streaming', provider: 'openai' })],
      { provider: 'anthropic', status: 'ok' },
    );
    expect(verdict.kind).toBe('update-in-place');
    if (verdict.kind === 'update-in-place') {
      expect(verdict.targetRowId).toBe('inf-stream');
    }
  });

  it('returns update-in-place when latest row is failed but incoming provider matches (re-delivery of the failure span)', () => {
    const verdict = decideInferenceWrite(
      [row({ id: 'inf-failed', status: 'failed', provider: 'openai' })],
      { provider: 'openai', status: 'failed' },
    );
    expect(verdict.kind).toBe('update-in-place');
    if (verdict.kind === 'update-in-place') {
      expect(verdict.targetRowId).toBe('inf-failed');
    }
  });

  it('returns update-in-place when latest row is ok but incoming provider differs (defensive — no prior failure)', () => {
    const verdict = decideInferenceWrite(
      [row({ id: 'inf-ok', status: 'ok', provider: 'openai' })],
      { provider: 'anthropic', status: 'ok' },
    );
    expect(verdict.kind).toBe('update-in-place');
    if (verdict.kind === 'update-in-place') {
      expect(verdict.targetRowId).toBe('inf-ok');
    }
  });

  it('returns insert-failover-attempt when latest row is failed and incoming provider differs, even with status=streaming on incoming', () => {
    // Failover attempts can start as streaming too — the SDK opens a span
    // before the second provider completes.
    const verdict = decideInferenceWrite(
      [row({ status: 'failed', provider: 'openai' })],
      { provider: 'anthropic', status: 'streaming' },
    );
    expect(verdict.kind).toBe('insert-failover-attempt');
  });
});
