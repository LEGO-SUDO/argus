// WS frame contract tests — chat-context-and-ux-polish backbone.
//
// Backbone LLD lives at docs/oh/chat-context-and-ux-polish/lld-backend-api.md.
// These tests pin:
//   - Task 1/2: `start` frame is identity-only (no provider/model).
//   - Task 3/4: outbound discriminated union accepts `metadata`.
//   - Task 5/6: `metadata.seq` is literally 1 (the slot immediately after start@0).
//   - Task 7/8: `end` frame carries optional non-negative `tokensUsed` + `tokensBudget`.
import {
  WsStartFrameSchema,
  WsFrameOutboundSchema,
  WsEndFrameSchema,
} from '../ws';
import { randomUUID } from 'crypto';

const messageId = randomUUID();
const conversationId = randomUUID();

describe('WsStartFrameSchema — identity only (Tasks 1/2)', () => {
  it('parses a minimal identity payload', () => {
    const out = WsStartFrameSchema.safeParse({
      type: 'start',
      messageId,
      conversationId,
      seq: 0,
    });
    expect(out.success).toBe(true);
  });

  it('rejects when `provider` is present', () => {
    const out = WsStartFrameSchema.safeParse({
      type: 'start',
      messageId,
      conversationId,
      seq: 0,
      provider: 'openai',
    });
    // strict() upgrades unknown keys to a parse error.
    expect(out.success).toBe(false);
  });

  it('rejects when `model` is present', () => {
    const out = WsStartFrameSchema.safeParse({
      type: 'start',
      messageId,
      conversationId,
      seq: 0,
      model: 'gpt-4o-mini',
    });
    expect(out.success).toBe(false);
  });
});

describe('Outbound union — metadata variant (Tasks 3/4/5/6)', () => {
  it('parses a valid metadata frame through the outbound union', () => {
    const out = WsFrameOutboundSchema.safeParse({
      type: 'metadata',
      messageId,
      seq: 1,
      providerMeta: { provider: 'openai', model: 'gpt-4o-mini' },
    });
    expect(out.success).toBe(true);
  });

  it('rejects a metadata frame missing providerMeta', () => {
    const out = WsFrameOutboundSchema.safeParse({
      type: 'metadata',
      messageId,
      seq: 1,
    });
    expect(out.success).toBe(false);
  });

  it('rejects unknown frame discriminants', () => {
    const out = WsFrameOutboundSchema.safeParse({
      type: 'totally-not-a-frame',
      messageId,
      seq: 1,
    });
    expect(out.success).toBe(false);
  });

  it('metadata.providerMeta passes through unknown keys (zod .passthrough())', () => {
    const out = WsFrameOutboundSchema.safeParse({
      type: 'metadata',
      messageId,
      seq: 1,
      providerMeta: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        // Unknown keys must land in the parsed object without contract churn —
        // protects against future `providerMeta` extensions.
        promptTokens: 42,
        completionTokens: 17,
        unrelatedFutureKey: 'still parses',
      },
    });
    expect(out.success).toBe(true);
  });

  it('Task 5/6: rejects metadata.seq other than literal 1', () => {
    for (const bad of [0, 2, 3, 100]) {
      const out = WsFrameOutboundSchema.safeParse({
        type: 'metadata',
        messageId,
        seq: bad,
        providerMeta: { provider: 'openai', model: 'gpt-4o-mini' },
      });
      expect(out.success).toBe(false);
    }
  });
});

describe('WsEndFrameSchema — optional context fields (Tasks 7/8)', () => {
  it('parses with both tokensUsed + tokensBudget', () => {
    const out = WsEndFrameSchema.safeParse({
      type: 'end',
      messageId,
      seq: 5,
      status: 'complete',
      tokensUsed: 1234,
      tokensBudget: 10000,
    });
    expect(out.success).toBe(true);
  });

  it('parses without the context fields (backward compat)', () => {
    const out = WsEndFrameSchema.safeParse({
      type: 'end',
      messageId,
      seq: 5,
      status: 'complete',
    });
    expect(out.success).toBe(true);
  });

  it('rejects negative tokensUsed', () => {
    const out = WsEndFrameSchema.safeParse({
      type: 'end',
      messageId,
      seq: 5,
      status: 'complete',
      tokensUsed: -1,
      tokensBudget: 10000,
    });
    expect(out.success).toBe(false);
  });

  it('rejects negative tokensBudget', () => {
    const out = WsEndFrameSchema.safeParse({
      type: 'end',
      messageId,
      seq: 5,
      status: 'complete',
      tokensUsed: 0,
      tokensBudget: -100,
    });
    expect(out.success).toBe(false);
  });
});
