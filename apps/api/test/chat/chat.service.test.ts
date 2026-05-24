// Tasks 29-30, 39-46 — ChatService.
import { ChatService, ConversationNotOwnedError } from '../../src/chat/chat.service';
import { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { randomUUID } from 'crypto';

function build(prisma: InMemoryPrisma): ChatService {
  return new ChatService(new PrismaService(prisma as never));
}

async function seedUserAndConv(prisma: InMemoryPrisma): Promise<{ userId: string; conversationId: string }> {
  const userId = randomUUID();
  const conversationId = randomUUID();
  prisma.users.push({ id: userId, email: 'u@t', passwordHash: 'x', createdAt: new Date() });
  prisma.conversations.push({
    id: conversationId,
    userId,
    title: 'c',
    createdAt: new Date(),
    lastMessageAt: null,
  });
  return { userId, conversationId };
}

describe('ChatService', () => {
  describe('mintMessageId', () => {
    it('produces 1000 distinct UUID v4 values', () => {
      const svc = build(createInMemoryPrisma());
      const seen = new Set<string>();
      const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      for (let i = 0; i < 1000; i++) {
        const id = svc.mintMessageId();
        expect(uuidV4.test(id)).toBe(true);
        seen.add(id);
      }
      expect(seen.size).toBe(1000);
    });
  });

  describe('startTurn', () => {
    it('rejects when the conversation does not belong to the user (defense-in-depth — the gateway also checks)', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { conversationId } = await seedUserAndConv(prisma);
      // A DIFFERENT user tries to start a turn on the seeded user's conversation.
      const intruderId = randomUUID();
      prisma.users.push({ id: intruderId, email: 'b@t', passwordHash: 'x', createdAt: new Date() });
      await expect(
        svc.startTurn({
          userId: intruderId,
          conversationId,
          userMessageContent: 'pwn',
        }),
      ).rejects.toBeInstanceOf(ConversationNotOwnedError);
      // Nothing persisted on the rejection path.
      expect(prisma.messages.length).toBe(0);
      expect(prisma.inferences.length).toBe(0);
    });

    it('rejects when the conversation does not exist', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const userId = randomUUID();
      prisma.users.push({ id: userId, email: 'u@t', passwordHash: 'x', createdAt: new Date() });
      await expect(
        svc.startTurn({
          userId,
          conversationId: randomUUID(),
          userMessageContent: 'hi',
        }),
      ).rejects.toBeInstanceOf(ConversationNotOwnedError);
    });

    it('persists user + assistant messages, updates conversation, and writes placeholder inference — atomically before returning', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const result = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'hi',
      });
      expect(result.assistantMessageId).not.toBe(result.userMessageId);

      const messages = prisma.messages.filter((m) => m.conversationId === conversationId);
      expect(messages).toHaveLength(2);
      const userMsg = messages.find((m) => m.role === 'user');
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(userMsg?.id).toBe(result.userMessageId);
      expect(userMsg?.content).toBe('hi');
      expect(userMsg?.status).toBe('complete');
      expect(assistantMsg?.id).toBe(result.assistantMessageId);
      expect(assistantMsg?.status).toBe('streaming');
      expect(assistantMsg?.content).toBe('');

      const conv = prisma.conversations.find((c) => c.id === conversationId);
      expect(conv?.lastMessageAt).not.toBeNull();

      const inference = prisma.inferences.find((i) => i.messageId === result.assistantMessageId);
      expect(inference).toBeDefined();
      expect(inference?.status).toBe('streaming');
      expect(inference?.promptTokens).toBeNull();
      expect(inference?.completionTokens).toBeNull();
      expect(inference?.userId).toBe(userId);
    });
  });

  describe('completeTurn', () => {
    it('sets status=complete, content=fullContent, completedAt set; inference untouched', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const { assistantMessageId } = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'hi',
      });
      const inferenceBefore = JSON.stringify(
        prisma.inferences.find((i) => i.messageId === assistantMessageId),
      );
      await svc.completeTurn(assistantMessageId, 'hello world');
      const msg = prisma.messages.find((m) => m.id === assistantMessageId);
      expect(msg?.status).toBe('complete');
      expect(msg?.content).toBe('hello world');
      expect(msg?.completedAt).not.toBeNull();
      const inferenceAfter = JSON.stringify(
        prisma.inferences.find((i) => i.messageId === assistantMessageId),
      );
      expect(inferenceAfter).toBe(inferenceBefore);
    });
  });

  describe('cancelTurn', () => {
    it('sets status=canceled, flushes partial content; inference untouched', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const { assistantMessageId } = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'hi',
      });
      const inferenceBefore = JSON.stringify(
        prisma.inferences.find((i) => i.messageId === assistantMessageId),
      );
      await svc.cancelTurn(assistantMessageId, 'partial...');
      const msg = prisma.messages.find((m) => m.id === assistantMessageId);
      expect(msg?.status).toBe('canceled');
      expect(msg?.content).toBe('partial...');
      expect(msg?.completedAt).not.toBeNull();
      const inferenceAfter = JSON.stringify(
        prisma.inferences.find((i) => i.messageId === assistantMessageId),
      );
      expect(inferenceAfter).toBe(inferenceBefore);
    });
  });

  // chat-context-and-ux-polish LLD Tasks 52/53 — startTurn now returns the
  // multi-turn history (excluding streaming rows) AND the conversation's pin
  // columns so the gateway can thread both into the SDK request without a
  // second query.
  describe('startTurn — multi-turn history + pin pass-through', () => {
    it('returns history in chronological order, excludes streaming rows, includes the just-persisted user message', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);

      // Pre-existing messages: one complete user turn + one streaming
      // assistant row (left over from a crashed prior turn — should be
      // EXCLUDED from history because it has no useful content yet).
      const earlierUserId = randomUUID();
      prisma.messages.push({
        id: earlierUserId,
        conversationId,
        userId,
        role: 'user',
        content: 'older user message',
        status: 'complete',
        createdAt: new Date(Date.now() - 2_000),
        completedAt: new Date(Date.now() - 1_900),
      });
      prisma.messages.push({
        id: randomUUID(),
        conversationId,
        userId,
        role: 'assistant',
        content: 'streaming artifact',
        status: 'streaming',
        createdAt: new Date(Date.now() - 1_000),
        completedAt: null,
      });

      const result = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'next user message',
      });
      expect(result.history).toBeDefined();
      const contents = result.history!.map((m) => m.content);
      // Streaming row dropped; older complete + new user present.
      expect(contents).toContain('older user message');
      expect(contents).toContain('next user message');
      expect(contents).not.toContain('streaming artifact');
      // Chronological — older first.
      expect(contents.indexOf('older user message')).toBeLessThan(
        contents.indexOf('next user message'),
      );
    });

    it('returns the conversation pin pair on the result so the gateway can thread it into the SDK request', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const userId = randomUUID();
      const conversationId = randomUUID();
      prisma.users.push({ id: userId, email: 'u@t', passwordHash: 'x', createdAt: new Date() });
      (prisma.conversations as unknown as Array<Record<string, unknown>>).push({
        id: conversationId,
        userId,
        title: 'c',
        createdAt: new Date(),
        lastMessageAt: null,
        pinnedProvider: 'anthropic',
        pinnedModel: 'claude-haiku-4-5',
      });
      const result = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'hi',
      });
      expect(result.pinnedProvider).toBe('anthropic');
      expect(result.pinnedModel).toBe('claude-haiku-4-5');
    });

    it('returns null pin pair when the conversation is unpinned', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const result = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'hi',
      });
      expect(result.pinnedProvider).toBeNull();
      expect(result.pinnedModel).toBeNull();
    });
  });

  describe('failTurn', () => {
    it('sets status=failed, flushes partial content, and persists errorCode + status into the placeholder inferences row', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const { assistantMessageId } = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'hi',
      });
      await svc.failTurn(assistantMessageId, 'partial fail', 'provider_unavailable');

      const msg = prisma.messages.find((m) => m.id === assistantMessageId);
      expect(msg?.status).toBe('failed');
      expect(msg?.content).toBe('partial fail');
      expect(msg?.completedAt).not.toBeNull();

      // errorCode MUST land on the inferences row so the history hydrate path
      // (MessagesRepository.listForConversation) surfaces it on MessageDto —
      // frontend-web Retry UX (Tasks 45/46) keys off MessageDto.errorCode.
      const inference = prisma.inferences.find((i) => i.messageId === assistantMessageId);
      expect(inference).toBeDefined();
      expect(inference?.errorCode).toBe('provider_unavailable');
      expect(inference?.status).toBe('failed');
      expect(inference?.endedAt).not.toBeNull();
    });

    it('records client_disconnected so the subsequent MessageDto hydrate surfaces it', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const { assistantMessageId } = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'hi',
      });
      await svc.failTurn(assistantMessageId, 'partial', 'client_disconnected');

      const inference = prisma.inferences.find((i) => i.messageId === assistantMessageId);
      expect(inference?.errorCode).toBe('client_disconnected');
    });
  });
});
