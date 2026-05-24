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
  WsSendFrameSchema,
  WsFrameInboundSchema,
} from '../ws';
import type { WsEndStatus } from '../ws';
import { randomUUID } from 'crypto';

const messageId = randomUUID();
const conversationId = randomUUID();

// chat-context-and-ux-polish (integration review — first-turn pin race). The
// send frame can OPTIONALLY carry a pin so the FIRST turn of a brand-new
// conversation honors the picker selection (the PATCH that persists the pin
// only lands after the `start` frame mints the conversation, too late for
// turn 1). Coupling mirrors UpdateConversationRequestSchema: both pin fields
// present-as-non-empty-strings together, or both omitted. Null is not
// meaningful on send (a send either carries a pin or doesn't — omit both for
// Auto/failover).
describe('WsSendFrameSchema — optional pin coupling (first-turn pin race)', () => {
  it('parses a send frame with NO pin (Auto — backward compat)', () => {
    const out = WsSendFrameSchema.safeParse({
      type: 'send',
      conversationId: null,
      content: 'hi',
    });
    expect(out.success).toBe(true);
  });

  it('parses a send frame on a new conversation (null conversationId) with both pin fields set', () => {
    const out = WsSendFrameSchema.safeParse({
      type: 'send',
      conversationId: null,
      content: 'hi',
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    expect(out.success).toBe(true);
  });

  it('parses a send frame on an existing conversation (uuid) with both pin fields set', () => {
    const out = WsSendFrameSchema.safeParse({
      type: 'send',
      conversationId: randomUUID(),
      content: 'hi',
      pinnedProvider: 'anthropic',
      pinnedModel: 'claude-haiku-4-5',
    });
    expect(out.success).toBe(true);
  });

  it('rejects when only pinnedProvider is present (coupling violation)', () => {
    const out = WsSendFrameSchema.safeParse({
      type: 'send',
      conversationId: null,
      content: 'hi',
      pinnedProvider: 'openai',
    });
    expect(out.success).toBe(false);
  });

  it('rejects when only pinnedModel is present (coupling violation)', () => {
    const out = WsSendFrameSchema.safeParse({
      type: 'send',
      conversationId: null,
      content: 'hi',
      pinnedModel: 'gpt-4o-mini',
    });
    expect(out.success).toBe(false);
  });

  it('rejects an empty-string pinnedProvider', () => {
    const out = WsSendFrameSchema.safeParse({
      type: 'send',
      conversationId: null,
      content: 'hi',
      pinnedProvider: '',
      pinnedModel: 'gpt-4o-mini',
    });
    expect(out.success).toBe(false);
  });

  it('rejects an empty-string pinnedModel', () => {
    const out = WsSendFrameSchema.safeParse({
      type: 'send',
      conversationId: null,
      content: 'hi',
      pinnedProvider: 'openai',
      pinnedModel: '',
    });
    expect(out.success).toBe(false);
  });

  it('rejects a null pinnedProvider (null is not meaningful on send — omit both for Auto)', () => {
    const out = WsSendFrameSchema.safeParse({
      type: 'send',
      conversationId: null,
      content: 'hi',
      pinnedProvider: null,
      pinnedModel: null,
    });
    expect(out.success).toBe(false);
  });

  it('still parses a pinned send frame through the inbound discriminated union', () => {
    const out = WsFrameInboundSchema.safeParse({
      type: 'send',
      conversationId: null,
      content: 'hi',
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    expect(out.success).toBe(true);
  });

  it('rejects an asymmetric pinned send frame through the inbound discriminated union', () => {
    const out = WsFrameInboundSchema.safeParse({
      type: 'send',
      conversationId: null,
      content: 'hi',
      pinnedProvider: 'openai',
    });
    expect(out.success).toBe(false);
  });
});

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

  // chat-context-and-ux-polish (Codex review — schema-level enforcement of
  // HLD D5: context fields are valid ONLY on `status: 'complete'`).
  describe('context fields are gated to status=complete', () => {
    for (const status of ['failed', 'canceled'] as WsEndStatus[]) {
      it(`rejects tokensUsed when status is "${status}"`, () => {
        const out = WsEndFrameSchema.safeParse({
          type: 'end',
          messageId,
          seq: 5,
          status,
          tokensUsed: 100,
        });
        expect(out.success).toBe(false);
      });

      it(`rejects tokensBudget when status is "${status}"`, () => {
        const out = WsEndFrameSchema.safeParse({
          type: 'end',
          messageId,
          seq: 5,
          status,
          tokensBudget: 10000,
        });
        expect(out.success).toBe(false);
      });

      it(`accepts a "${status}" end frame WITHOUT context fields`, () => {
        const out = WsEndFrameSchema.safeParse({
          type: 'end',
          messageId,
          seq: 5,
          status,
        });
        expect(out.success).toBe(true);
      });
    }

    it('enforces the same constraint through the outbound discriminated union', () => {
      const bad = WsFrameOutboundSchema.safeParse({
        type: 'end',
        messageId,
        seq: 5,
        status: 'failed',
        tokensUsed: 100,
        tokensBudget: 10000,
      });
      expect(bad.success).toBe(false);

      const good = WsFrameOutboundSchema.safeParse({
        type: 'end',
        messageId,
        seq: 5,
        status: 'complete',
        tokensUsed: 100,
        tokensBudget: 10000,
      });
      expect(good.success).toBe(true);
    });
  });
});
