// 100KB span-event payload cap with truncation marker.
//
// Per HLD §D4, full I/O lives in trace_events.payload (JSONB) but is bounded
// to keep Postgres TOAST happy and to give Replay a predictable upper limit.
// Over-cap payloads land with a sentinel marker so Phase B Replay treats them
// as "non-replayable, see preview".

export const PAYLOAD_CAP_BYTES = 100 * 1024; // 100 KB
// Leave headroom for the truncation-marker keys + the truncated body slice.
const SAFE_BODY_BYTES = 95 * 1024;

export interface CappedPayload {
  payload: unknown;
  truncated: boolean;
  replayable: boolean;
}

function byteLen(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export function capSpanEventPayload(input: unknown): CappedPayload {
  if (input === null || input === undefined) {
    return { payload: input ?? null, truncated: false, replayable: true };
  }
  const serialized = JSON.stringify(input);
  if (serialized === undefined) {
    // JSON.stringify returned undefined (e.g. raw symbol/function) — store null.
    return { payload: null, truncated: false, replayable: true };
  }
  const size = byteLen(serialized);
  if (size <= PAYLOAD_CAP_BYTES) {
    return { payload: input, truncated: false, replayable: true };
  }
  // Truncate: best-effort string slice down to a safe byte boundary, then
  // wrap with marker keys. We don't try to keep JSON structure — Phase B
  // Replay already has to handle truncated payloads as non-replayable.
  const slice = sliceUtf8(serialized, SAFE_BODY_BYTES);
  return {
    payload: {
      __truncated: true,
      __original_bytes: size,
      __preview: slice,
    },
    truncated: true,
    replayable: false,
  };
}

/**
 * Slice a string to AT MOST `maxBytes` of UTF-8 without splitting a
 * multi-byte codepoint. Simpler / safer than character-count slicing.
 */
function sliceUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  // Walk back until we land on a valid UTF-8 char boundary.
  let end = maxBytes;
  while (end > 0 && (buf[end] !== undefined && (buf[end]! & 0xc0) === 0x80)) {
    end -= 1;
  }
  return buf.slice(0, end).toString('utf8');
}
