// Frame-builder helpers validated against contracts schemas.
//
// chat-context-and-ux-polish backbone (LLD Tasks 36/37/39):
//   - `buildStartFrame` is identity-only (no provider/model — Task 2/39).
//   - `buildMetadataFrame` is the seq=1 envelope sourced from the SDK
//     `commit` chunk's providerMeta payload (Task 36).
import {
  buildCancelAckFrame,
  buildEndFrame,
  buildErrorFrame,
  buildMetadataFrame,
  buildStartFrame,
  buildTokenFrame,
} from '../../src/chat/frame-builder';
import { WsFrameOutboundSchema, WsMetadataFrameSchema } from '@argus/contracts';
import { SeqCounter } from '../../src/chat/seq-counter';
import { randomUUID } from 'crypto';

const conversationId = randomUUID();
const messageId = randomUUID();

describe('frame-builder', () => {
  it('buildStartFrame returns a valid identity-only start envelope with seq=0', () => {
    const frame = buildStartFrame({
      messageId,
      conversationId,
    });
    expect(frame).toEqual({
      type: 'start',
      messageId,
      conversationId,
      seq: 0,
    });
    expect(WsFrameOutboundSchema.safeParse(frame).success).toBe(true);
  });

  it('buildMetadataFrame returns a valid metadata envelope at seq=1 carrying providerMeta', () => {
    const providerMeta = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptTokens: 7,
      completionTokens: 3,
    };
    const frame = buildMetadataFrame(messageId, providerMeta);
    expect(frame).toEqual({
      type: 'metadata',
      messageId,
      seq: 1,
      providerMeta,
    });
    expect(WsMetadataFrameSchema.safeParse(frame).success).toBe(true);
    expect(WsFrameOutboundSchema.safeParse(frame).success).toBe(true);
  });

  it('buildTokenFrame returns a valid token envelope', () => {
    const frame = buildTokenFrame(messageId, 1, 'hello ');
    expect(frame).toEqual({ type: 'token', messageId, seq: 1, content: 'hello ' });
    expect(WsFrameOutboundSchema.safeParse(frame).success).toBe(true);
  });

  it('successive buildTokenFrame calls driven by a SeqCounter increase strictly from 1', () => {
    const counter = new SeqCounter();
    counter.next(); // consume 0 (start)
    const f1 = buildTokenFrame(messageId, counter.next(), 'a');
    const f2 = buildTokenFrame(messageId, counter.next(), 'b');
    const f3 = buildTokenFrame(messageId, counter.next(), 'c');
    expect([f1.seq, f2.seq, f3.seq]).toEqual([1, 2, 3]);
  });

  it.each(['complete', 'canceled', 'failed'] as const)(
    'buildEndFrame status=%s is valid',
    (status) => {
      const frame = buildEndFrame(messageId, 5, status);
      expect(frame).toEqual({ type: 'end', messageId, seq: 5, status });
      expect(WsFrameOutboundSchema.safeParse(frame).success).toBe(true);
    },
  );

  it('buildErrorFrame includes errorCode and optional message', () => {
    const withMsg = buildErrorFrame(messageId, 'provider_unavailable', 'upstream timeout');
    expect(withMsg).toEqual({
      type: 'error',
      messageId,
      errorCode: 'provider_unavailable',
      message: 'upstream timeout',
    });
    expect(WsFrameOutboundSchema.safeParse(withMsg).success).toBe(true);

    const noMsg = buildErrorFrame(messageId, 'sdk_error');
    expect(noMsg).toEqual({ type: 'error', messageId, errorCode: 'sdk_error' });
    expect(WsFrameOutboundSchema.safeParse(noMsg).success).toBe(true);
  });

  it('buildCancelAckFrame returns a valid cancel-ack envelope', () => {
    const frame = buildCancelAckFrame(messageId);
    expect(frame).toEqual({ type: 'cancel-ack', messageId });
    expect(WsFrameOutboundSchema.safeParse(frame).success).toBe(true);
  });
});
