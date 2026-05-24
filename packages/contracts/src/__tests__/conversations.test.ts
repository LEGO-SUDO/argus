// Conversations contract tests — chat-context-and-ux-polish backbone.
//
// Backbone LLD: docs/oh/chat-context-and-ux-polish/lld-backend-api.md.
// Pins:
//   - Task 9/10: MessageListResponseSchema accepts optional `tokensUsed` + `tokensBudget`.
//   - Task 11/12: UpdateConversationRequestSchema accepts pin fields with coupling rule.
//   - Task 13/14: ConversationDtoSchema exposes optional nullable pin fields.
//   - Task 87/88: MessageListResponseSchema accepts `pinFallback` + `previouslyPinned`
//     read-time downgrade signals.
import {
  MessageListResponseSchema,
  UpdateConversationRequestSchema,
  ConversationDtoSchema,
} from '../conversations';
import { randomUUID } from 'crypto';

const conversationId = randomUUID();
const messageId = randomUUID();

function baseMessage() {
  return {
    id: messageId,
    conversationId,
    role: 'user' as const,
    content: 'hi',
    status: 'complete' as const,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

describe('MessageListResponseSchema — context fields (Tasks 9/10)', () => {
  it('parses a response without the context fields (backward compat)', () => {
    const out = MessageListResponseSchema.safeParse({
      messages: [baseMessage()],
    });
    expect(out.success).toBe(true);
  });

  it('parses with both tokensUsed + tokensBudget', () => {
    const out = MessageListResponseSchema.safeParse({
      messages: [baseMessage()],
      tokensUsed: 250,
      tokensBudget: 10000,
    });
    expect(out.success).toBe(true);
  });

  it('rejects negative tokensUsed', () => {
    const out = MessageListResponseSchema.safeParse({
      messages: [baseMessage()],
      tokensUsed: -1,
      tokensBudget: 10000,
    });
    expect(out.success).toBe(false);
  });

  it('rejects negative tokensBudget', () => {
    const out = MessageListResponseSchema.safeParse({
      messages: [baseMessage()],
      tokensUsed: 0,
      tokensBudget: -500,
    });
    expect(out.success).toBe(false);
  });
});

describe('UpdateConversationRequestSchema — pin coupling (Tasks 11/12)', () => {
  it('still parses the existing { title } body', () => {
    const out = UpdateConversationRequestSchema.safeParse({ title: 'renamed' });
    expect(out.success).toBe(true);
  });

  it('parses with both pin fields set (set-pin)', () => {
    const out = UpdateConversationRequestSchema.safeParse({
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    expect(out.success).toBe(true);
  });

  it('parses with both pin fields null together (clear-pin)', () => {
    const out = UpdateConversationRequestSchema.safeParse({
      pinnedProvider: null,
      pinnedModel: null,
    });
    expect(out.success).toBe(true);
  });

  it('rejects when only one pin field is present (coupling violation)', () => {
    const onlyProvider = UpdateConversationRequestSchema.safeParse({
      pinnedProvider: 'openai',
    });
    expect(onlyProvider.success).toBe(false);
    const onlyModel = UpdateConversationRequestSchema.safeParse({
      pinnedModel: 'gpt-4o-mini',
    });
    expect(onlyModel.success).toBe(false);
  });

  it('parses an empty body (no-op PATCH)', () => {
    const out = UpdateConversationRequestSchema.safeParse({});
    expect(out.success).toBe(true);
  });

  it('rejects empty-string pin fields (must be a real model id or null)', () => {
    const emptyProvider = UpdateConversationRequestSchema.safeParse({
      pinnedProvider: '',
      pinnedModel: 'gpt-4o-mini',
    });
    expect(emptyProvider.success).toBe(false);
    const emptyModel = UpdateConversationRequestSchema.safeParse({
      pinnedProvider: 'openai',
      pinnedModel: '',
    });
    expect(emptyModel.success).toBe(false);
  });

  it('parses title + pin together', () => {
    const out = UpdateConversationRequestSchema.safeParse({
      title: 'renamed',
      pinnedProvider: 'anthropic',
      pinnedModel: 'claude-haiku-4-5',
    });
    expect(out.success).toBe(true);
  });
});

describe('ConversationDtoSchema — pin fields (Tasks 13/14)', () => {
  it('round-trips with pin fields set', () => {
    const out = ConversationDtoSchema.safeParse({
      id: conversationId,
      title: 'pinned conversation',
      createdAt: new Date().toISOString(),
      lastMessageAt: null,
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    expect(out.success).toBe(true);
  });

  it('round-trips with explicit null pin fields', () => {
    const out = ConversationDtoSchema.safeParse({
      id: conversationId,
      title: 'unpinned',
      createdAt: new Date().toISOString(),
      lastMessageAt: null,
      pinnedProvider: null,
      pinnedModel: null,
    });
    expect(out.success).toBe(true);
  });

  it('still parses without the pin fields (backward compat)', () => {
    const out = ConversationDtoSchema.safeParse({
      id: conversationId,
      title: 't',
      createdAt: new Date().toISOString(),
      lastMessageAt: null,
    });
    expect(out.success).toBe(true);
  });
});

describe('MessageListResponseSchema — fallback signals (Tasks 87/88)', () => {
  it('parses with pinFallback=true + previouslyPinned object', () => {
    const out = MessageListResponseSchema.safeParse({
      messages: [baseMessage()],
      pinFallback: true,
      previouslyPinned: { provider: 'openai', model: 'gpt-unicorn-9000' },
    });
    expect(out.success).toBe(true);
  });

  it('parses with pinFallback=false and no previouslyPinned', () => {
    const out = MessageListResponseSchema.safeParse({
      messages: [baseMessage()],
      pinFallback: false,
    });
    expect(out.success).toBe(true);
  });

  it('still parses with no fallback signals at all (backward compat)', () => {
    const out = MessageListResponseSchema.safeParse({
      messages: [baseMessage()],
    });
    expect(out.success).toBe(true);
  });
});

// chat-context-and-ux-polish LLD Task 86 (Codex review #6) — the effective
// conversation DTO travels with the messages list.
describe('MessageListResponseSchema — conversation DTO (Task 86)', () => {
  function baseConversation(pin: { pinnedProvider: string | null; pinnedModel: string | null }) {
    return {
      id: conversationId,
      title: 't',
      createdAt: new Date().toISOString(),
      lastMessageAt: null,
      pinnedProvider: pin.pinnedProvider,
      pinnedModel: pin.pinnedModel,
    };
  }

  it('parses with a conversation DTO carrying a set pin', () => {
    const out = MessageListResponseSchema.safeParse({
      conversation: baseConversation({ pinnedProvider: 'openai', pinnedModel: 'gpt-4o-mini' }),
      messages: [baseMessage()],
    });
    expect(out.success).toBe(true);
  });

  it('parses with a conversation DTO carrying both pin fields null (unpinned)', () => {
    const out = MessageListResponseSchema.safeParse({
      conversation: baseConversation({ pinnedProvider: null, pinnedModel: null }),
      messages: [baseMessage()],
    });
    expect(out.success).toBe(true);
  });

  it('still parses without the conversation key (backward compat)', () => {
    const out = MessageListResponseSchema.safeParse({
      messages: [baseMessage()],
    });
    expect(out.success).toBe(true);
  });
});
