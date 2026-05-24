// Task 10 (RED) / Task 11 (GREEN): 100KB span-event payload cap with
// truncation marker.
import { capSpanEventPayload, PAYLOAD_CAP_BYTES } from '../src/projection/payload-cap';

describe('capSpanEventPayload', () => {
  it('passes small payloads through unchanged with truncated=false', () => {
    const payload = { messages: [{ role: 'user', content: 'hello' }] };
    const result = capSpanEventPayload(payload);
    expect(result.truncated).toBe(false);
    expect(result.replayable).toBe(true);
    expect(result.payload).toEqual(payload);
  });

  it('truncates payloads larger than 100KB and sets truncated=true + replayable=false', () => {
    // Build a payload that, serialized, exceeds 100KB.
    const big = { content: 'x'.repeat(PAYLOAD_CAP_BYTES + 50_000) };
    const result = capSpanEventPayload(big);
    expect(result.truncated).toBe(true);
    expect(result.replayable).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(result.payload), 'utf8')).toBeLessThanOrEqual(
      PAYLOAD_CAP_BYTES,
    );
    // Truncation marker carries original byte length and a sentinel flag.
    expect(result.payload).toMatchObject({
      __truncated: true,
      __original_bytes: expect.any(Number),
    });
  });

  it('payload right at the boundary is left alone', () => {
    // Construct a payload that serialises to just under the cap.
    const safe = 'a'.repeat(PAYLOAD_CAP_BYTES - 100);
    const result = capSpanEventPayload({ s: safe });
    expect(result.truncated).toBe(false);
    expect(result.replayable).toBe(true);
  });

  it('null payload is treated as not-truncated', () => {
    const result = capSpanEventPayload(null);
    expect(result.truncated).toBe(false);
    expect(result.replayable).toBe(true);
    expect(result.payload).toBeNull();
  });
});
