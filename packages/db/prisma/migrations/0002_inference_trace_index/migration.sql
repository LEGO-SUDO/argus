-- Add an index on (trace_id, span_id) to the inferences table.
--
-- Rationale: the projection consumer's failover detector and Phase B debug
-- queries look up inferences by (trace_id, span_id); without this index those
-- lookups full-scan the inferences table.
--
-- Non-unique: failover-history rows may legitimately share a (trace, span)
-- with an enrichment write in some future Phase B migration; the trace_events
-- unique index is the authoritative dedupe primitive.

-- CreateIndex
CREATE INDEX "inferences_trace_id_span_id_idx" ON "inferences"("trace_id", "span_id");
