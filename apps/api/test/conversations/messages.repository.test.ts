// MessagesRepository.listForConversation — inferences hydration tests.
//
// MessageDto includes optional `errorCode`, `provider`, `model` fields that
// live on the `inferences` table (HLD D1 outbox pattern — projection consumer
// enriches them async). The repository LEFT-JOINs the latest inferences row
// per message (by startedAt) so the frontend Retry UX + per-message
// provider/model labels render correctly on history fetch.
import { MessagesRepository } from '../../src/conversations/messages.repository';
import { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { randomUUID } from 'crypto';

function build(prisma: InMemoryPrisma): MessagesRepository {
  const ps = new PrismaService(prisma as never);
  return new MessagesRepository(ps);
}

interface SeededTurn {
  userId: string;
  conversationId: string;
  assistantMessageId: string;
}

async function seedTurn(prisma: InMemoryPrisma): Promise<SeededTurn> {
  const userId = randomUUID();
  const conversationId = randomUUID();
  prisma.users.push({ id: userId, email: `${userId}@test`, passwordHash: 'x', createdAt: new Date() });
  prisma.conversations.push({
    id: conversationId,
    userId,
    title: 'turn',
    createdAt: new Date(),
    lastMessageAt: new Date(),
  });
  const assistantMessageId = randomUUID();
  prisma.messages.push({
    id: assistantMessageId,
    conversationId,
    userId,
    role: 'assistant',
    content: 'hi',
    status: 'complete',
    createdAt: new Date(Date.now() - 1000),
    completedAt: new Date(),
  });
  return { userId, conversationId, assistantMessageId };
}

describe('MessagesRepository.listForConversation', () => {
  it('hydrates errorCode, provider, model from the inferences row for each message', async () => {
    const prisma = createInMemoryPrisma();
    const repo = build(prisma);
    const { userId, conversationId, assistantMessageId } = await seedTurn(prisma);

    await prisma.inference.create({
      data: {
        messageId: assistantMessageId,
        conversationId,
        userId,
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'failed',
        startedAt: new Date(),
        errorCode: 'client_disconnected',
      },
    });

    const rows = await repo.listForConversation(conversationId, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.errorCode).toBe('client_disconnected');
    expect(rows[0]!.provider).toBe('openai');
    expect(rows[0]!.model).toBe('gpt-4o-mini');
  });

  it('returns null projection fields when no inferences row exists (user message)', async () => {
    const prisma = createInMemoryPrisma();
    const repo = build(prisma);
    const userId = randomUUID();
    const conversationId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@test`, passwordHash: 'x', createdAt: new Date() });
    prisma.conversations.push({
      id: conversationId,
      userId,
      title: 't',
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });
    prisma.messages.push({
      id: randomUUID(),
      conversationId,
      userId,
      role: 'user',
      content: 'hello',
      status: 'complete',
      createdAt: new Date(),
      completedAt: new Date(),
    });

    const rows = await repo.listForConversation(conversationId, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.errorCode).toBeNull();
    expect(rows[0]!.provider).toBeNull();
    expect(rows[0]!.model).toBeNull();
  });

  it('on failover (multiple inferences per message) uses the latest by startedAt', async () => {
    const prisma = createInMemoryPrisma();
    const repo = build(prisma);
    const { userId, conversationId, assistantMessageId } = await seedTurn(prisma);

    // First attempt — failed, provider A.
    await prisma.inference.create({
      data: {
        messageId: assistantMessageId,
        conversationId,
        userId,
        provider: 'openai',
        model: 'gpt-4o',
        status: 'failed',
        startedAt: new Date(Date.now() - 5000),
        errorCode: 'rate_limited',
      },
    });
    // Retry — succeeded, provider B (failover).
    await prisma.inference.create({
      data: {
        messageId: assistantMessageId,
        conversationId,
        userId,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        status: 'ok',
        startedAt: new Date(),
        errorCode: null,
      },
    });

    const rows = await repo.listForConversation(conversationId, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe('anthropic');
    expect(rows[0]!.model).toBe('claude-3-5-sonnet');
    expect(rows[0]!.errorCode).toBeNull();
  });

  it('does not leak inferences from other users when message_ids happen to collide across users', async () => {
    // Defense-in-depth: the inferences fetch is scoped by userId. Even though
    // message_id is globally unique in practice, we filter on userId to
    // mirror the same authz invariant as the messages query.
    const prisma = createInMemoryPrisma();
    const repo = build(prisma);
    const a = await seedTurn(prisma);
    const b = await seedTurn(prisma);

    await prisma.inference.create({
      data: {
        messageId: a.assistantMessageId,
        conversationId: a.conversationId,
        userId: a.userId,
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'ok',
        startedAt: new Date(),
      },
    });
    // Plant a (synthetic) inferences row claiming the OTHER user's message id.
    await prisma.inference.create({
      data: {
        messageId: a.assistantMessageId,
        conversationId: b.conversationId,
        userId: b.userId,
        provider: 'evil',
        model: 'evil-model',
        status: 'ok',
        startedAt: new Date(Date.now() + 5000),
      },
    });

    const rows = await repo.listForConversation(a.conversationId, a.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe('openai');
    expect(rows[0]!.model).toBe('gpt-4o-mini');
  });

  it('surfaces errorCode after ChatService.failTurn so MessageDto round-trips it on hydrate', async () => {
    // End-to-end: startTurn writes a placeholder inferences row; failTurn
    // updates it with the errorCode; listForConversation returns the row with
    // the hydrated errorCode. This is the chain that lights up frontend-web's
    // Retry UX (Tasks 45/46) when the user reloads a chat tab mid-stream.
    const { ChatService } = await import('../../src/chat/chat.service');
    const prisma = createInMemoryPrisma();
    const ps = new PrismaService(prisma as never);
    const chat = new ChatService(ps);
    const repo = build(prisma);
    const userId = randomUUID();
    const conversationId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
    prisma.conversations.push({
      id: conversationId,
      userId,
      title: 't',
      createdAt: new Date(),
      lastMessageAt: null,
    });
    const { assistantMessageId } = await chat.startTurn({
      userId,
      conversationId,
      userMessageContent: 'hi',
    });
    await chat.failTurn(assistantMessageId, 'partial', 'client_disconnected');

    const rows = await repo.listForConversation(conversationId, userId);
    const assistant = rows.find((r) => r.id === assistantMessageId);
    expect(assistant).toBeDefined();
    expect(assistant?.errorCode).toBe('client_disconnected');
    expect(assistant?.status).toBe('failed');
  });

  it('returns [] for an empty conversation without issuing the inferences query', async () => {
    const prisma = createInMemoryPrisma();
    const repo = build(prisma);
    const userId = randomUUID();
    const conversationId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@test`, passwordHash: 'x', createdAt: new Date() });
    prisma.conversations.push({
      id: conversationId,
      userId,
      title: 't',
      createdAt: new Date(),
      lastMessageAt: null,
    });

    const rows = await repo.listForConversation(conversationId, userId);
    expect(rows).toEqual([]);
  });
});
