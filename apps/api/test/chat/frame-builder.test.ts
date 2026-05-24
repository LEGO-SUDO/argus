// Tasks 33-38 — frame-builder helpers validated against contracts schemas.
import {
  buildCancelAckFrame,
  buildEndFrame,
  buildErrorFrame,
  buildStartFrame,
  buildTokenFrame,
} from '../../src/chat/frame-builder';
import { WsFrameOutboundSchema } from '@argus/contracts';
import { SeqCounter } from '../../src/chat/seq-counter';
import { randomUUID } from 'crypto';

const conversationId = randomUUID();
const messageId = randomUUID();

describe('frame-builder', () => {
  it('buildStartFrame returns a valid start envelope with seq=0', () => {
    const frame = buildStartFrame({
      messageId,
      conversationId,
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    expect(frame).toMatchObject({
      type: 'start',
      messageId,
      conversationId,
      provider: 'openai',
      model: 'gpt-4o-mini',
      seq: 0,
    });
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
