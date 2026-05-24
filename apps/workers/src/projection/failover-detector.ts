// Pure decision function.
//
// Given the inferences rows already present for a given message_id and the
// (provider, status) of the incoming span, decide which write to perform.
//
// Three verdicts:
//   - update-in-place             — enrich the existing placeholder/streaming row
//   - insert-failover-attempt     — append a new attempt linked by message_id
//   - insert-placeholder-missing  — gateway hasn't inserted the placeholder yet
//
// Failover trigger (per LLD Task 8): a new attempt row is appended ONLY when
// BOTH conditions hold:
//   (a) the latest existing row has status='failed', AND
//   (b) the incoming span's provider differs from that failed row.
//
// Otherwise we update in place. This guards against spurious failover rows
// when the SDK swaps provider mid-stream (e.g. a still-streaming placeholder
// was inserted under a guess-provider and the actual span carries the real
// one) — in those cases the streaming placeholder gets overwritten regardless
// of provider, because there was no real failure to attribute the second
// attempt to.
//
// `insert-placeholder-missing` is treated as a recoverable warning: the
// consumer logs it, captures a Sentry breadcrumb (recoverable=yes), and
// CREATES the row anyway so we never lose data.

export interface ExistingInferenceRow {
  id: string;
  provider: string;
  status: 'streaming' | 'ok' | 'failed' | 'canceled';
  startedAt: Date;
}

export interface IncomingSpanShape {
  provider: string;
  status: 'streaming' | 'ok' | 'failed' | 'canceled';
}

export type FailoverVerdict =
  | { kind: 'update-in-place'; targetRowId: string }
  | { kind: 'insert-failover-attempt' }
  | { kind: 'insert-placeholder-missing' };

export function decideInferenceWrite(
  existing: ExistingInferenceRow[],
  incoming: IncomingSpanShape,
): FailoverVerdict {
  if (existing.length === 0) {
    return { kind: 'insert-placeholder-missing' };
  }
  // Latest by startedAt desc. We don't trust order in — sort defensively.
  const sorted = [...existing].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  );
  // Non-null because length > 0 and sort preserves length.
  const latest = sorted[0] as ExistingInferenceRow;

  // Failover requires BOTH (a) a prior failure AND (b) a provider switch.
  // Anything else is a same-attempt enrichment (update-in-place).
  if (latest.status === 'failed' && latest.provider !== incoming.provider) {
    return { kind: 'insert-failover-attempt' };
  }

  return { kind: 'update-in-place', targetRowId: latest.id };
}
