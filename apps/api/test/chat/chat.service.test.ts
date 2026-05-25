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

    it('defaults kind=chat with all linkage columns null (Phase A back-compat)', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const { assistantMessageId } = await svc.startTurn({ userId, conversationId, userMessageContent: 'hi' });
      const inf = prisma.inferences.find((i) => i.messageId === assistantMessageId)!;
      expect(inf.kind).toBe('chat');
      expect(inf.classifierForMessageId).toBeNull();
      expect(inf.replayOfInferenceId).toBeNull();
      expect(inf.sampleWorkspaceId).toBeNull();
    });

    it('kind=replay sets replayOfInferenceId on the placeholder row', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const sourceId = randomUUID();
      const { assistantMessageId } = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'rerun',
        kind: 'replay',
        replayOfInferenceId: sourceId,
      });
      const inf = prisma.inferences.find((i) => i.messageId === assistantMessageId)!;
      expect(inf.kind).toBe('replay');
      expect(inf.replayOfInferenceId).toBe(sourceId);
    });

    it('kind=sample sets sampleWorkspaceId on the placeholder row', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const workspaceId = randomUUID();
      const { assistantMessageId } = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'sample',
        kind: 'sample',
        sampleWorkspaceId: workspaceId,
      });
      const inf = prisma.inferences.find((i) => i.messageId === assistantMessageId)!;
      expect(inf.kind).toBe('sample');
      expect(inf.sampleWorkspaceId).toBe(workspaceId);
    });

    it('kind=classifier sets classifierForMessageId on the placeholder row', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const userMsgId = randomUUID();
      const { assistantMessageId } = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'classify',
        kind: 'classifier',
        classifierMessageId: userMsgId,
      });
      const inf = prisma.inferences.find((i) => i.messageId === assistantMessageId)!;
      expect(inf.kind).toBe('classifier');
      expect(inf.classifierForMessageId).toBe(userMsgId);
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

    // chat-context-and-ux-polish (Codex review — concurrent-sends history
    // contamination). Two concurrent sends on the SAME conversation must not
    // cross-contaminate the history threaded to the SDK: each call's threaded
    // history must contain its OWN user message exactly once and NEVER the
    // other call's user message (which hasn't committed yet from this call's
    // perspective). The fix moves the history read inside the same
    // transaction as the user-message insert; the test fixture serializes
    // transactions to model Postgres isolation, so a transaction's read sees
    // only its own write plus prior-committed rows.
    it('two concurrent sends do not contaminate each other’s threaded history', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);

      const [resA, resB] = await Promise.all([
        svc.startTurn({ userId, conversationId, userMessageContent: 'message-A' }),
        svc.startTurn({ userId, conversationId, userMessageContent: 'message-B' }),
      ]);

      const contentsA = resA.history!.map((m) => m.content);
      const contentsB = resB.history!.map((m) => m.content);

      // Each call's history includes its OWN user message exactly once.
      expect(contentsA.filter((c) => c === 'message-A')).toHaveLength(1);
      expect(contentsB.filter((c) => c === 'message-B')).toHaveLength(1);

      // The FIRST transaction to run (whichever it is) must NOT see the other
      // call's message — its read happened before the peer committed. The
      // SECOND may legitimately include the first's committed message. So
      // exactly one of the two histories is "clean" (no peer message) and the
      // other may carry it — but NEITHER may carry the peer's message AND its
      // own at a position that implies interleaving within a single
      // transaction. The load-bearing invariant: no history contains BOTH
      // foreign and own user message with the foreign one inserted by the
      // still-in-flight peer (i.e. the earlier transaction's history must be
      // free of the later one's message).
      const aHasB = contentsA.includes('message-B');
      const bHasA = contentsB.includes('message-A');
      // At most one direction of inclusion is allowed (the later transaction
      // seeing the earlier's committed row). Both-see-each-other would mean
      // the reads interleaved with the peer's uncommitted insert.
      expect(aHasB && bHasA).toBe(false);
    });
  });

  // chat-context-and-ux-polish (integration review — first-turn pin race).
  // When the WS `send` frame carries a (catalog-validated) pin, startTurn
  // persists it onto the conversation row inside the same transaction as the
  // message inserts — scoped by userId — so turn 2+ read it via the persisted
  // path. The gateway does the catalog validation; startTurn trusts the pin.
  describe('startTurn — send-frame pin persistence', () => {
    it('persists the pin onto a brand-new (previously unpinned) conversation and returns it', async () => {
      const prisma = createInMemoryPrisma();
      const svc = build(prisma);
      const { userId, conversationId } = await seedUserAndConv(prisma);
      const result = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'hi',
        pin: { provider: 'anthropic', model: 'claude-haiku-4-5' },
      });
      // Returned pin pair reflects the just-persisted value.
      expect(result.pinnedProvider).toBe('anthropic');
      expect(result.pinnedModel).toBe('claude-haiku-4-5');
      // Persisted onto the row.
      const conv = prisma.conversations.find((c) => c.id === conversationId);
      expect(conv?.pinnedProvider).toBe('anthropic');
      expect(conv?.pinnedModel).toBe('claude-haiku-4-5');
    });

    it('overwrites an existing persisted pin with the send-frame pin', async () => {
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
        pinnedProvider: 'openai',
        pinnedModel: 'gpt-4o-mini',
      });
      const result = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'hi',
        pin: { provider: 'anthropic', model: 'claude-haiku-4-5' },
      });
      expect(result.pinnedProvider).toBe('anthropic');
      expect(result.pinnedModel).toBe('claude-haiku-4-5');
      const conv = prisma.conversations.find((c) => c.id === conversationId);
      expect(conv?.pinnedProvider).toBe('anthropic');
      expect(conv?.pinnedModel).toBe('claude-haiku-4-5');
    });

    it('leaves the pin untouched when no send-frame pin is supplied', async () => {
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
        pinnedProvider: 'openai',
        pinnedModel: 'gpt-4o-mini',
      });
      const result = await svc.startTurn({
        userId,
        conversationId,
        userMessageContent: 'hi',
      });
      // Persisted pin preserved (no pin arg → no write).
      expect(result.pinnedProvider).toBe('openai');
      expect(result.pinnedModel).toBe('gpt-4o-mini');
      const conv = prisma.conversations.find((c) => c.id === conversationId);
      expect(conv?.pinnedProvider).toBe('openai');
      expect(conv?.pinnedModel).toBe('gpt-4o-mini');
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
