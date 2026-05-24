// ConversationsController — focused on the omittedCount wiring on
// `GET /conversations/:id/messages`. Other CRUD paths are exercised through
// the repository tests; this test pins the controller's job of taking the
// rows and decorating the response with the context-window indicator
// (frontend-web Task 42 "N earlier messages omitted from context").
import { ConversationsController } from '../../src/conversations/conversations.controller';
import { ConversationsRepository } from '../../src/conversations/conversations.repository';
import { MessagesRepository } from '../../src/conversations/messages.repository';
import { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { randomUUID } from 'crypto';
import type { AuthenticatedRequest } from '../../src/auth/session.guard';

function build(prisma: InMemoryPrisma): {
  controller: ConversationsController;
  prisma: InMemoryPrisma;
} {
  const ps = new PrismaService(prisma as never);
  const conversations = new ConversationsRepository(ps);
  const messages = new MessagesRepository(ps);
  const controller = new ConversationsController(conversations, messages);
  return { controller, prisma };
}

function req(userId: string): AuthenticatedRequest {
  return { user: { id: userId } } as AuthenticatedRequest;
}

const ORIGINAL_BUDGET = process.env.CONTEXT_TOKEN_BUDGET;

afterEach(() => {
  if (ORIGINAL_BUDGET === undefined) delete process.env.CONTEXT_TOKEN_BUDGET;
  else process.env.CONTEXT_TOKEN_BUDGET = ORIGINAL_BUDGET;
});

describe('ConversationsController.listMessages', () => {
  it('omits the omittedCount field entirely when nothing is dropped (default budget, small conversation)', async () => {
    const { controller, prisma } = build(createInMemoryPrisma());
    const userId = randomUUID();
    const conversationId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
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
      content: 'hi',
      status: 'complete',
      createdAt: new Date(),
      completedAt: new Date(),
    });
    const res = await controller.listMessages(req(userId), conversationId);
    expect(res.messages).toHaveLength(1);
    // Omitted when zero — keeps the response minimal AND matches the
    // "indicator only when relevant" UI contract.
    expect(res.omittedCount).toBeUndefined();
  });

  it('returns omittedCount > 0 when older messages exceed the token budget', async () => {
    process.env.CONTEXT_TOKEN_BUDGET = '100'; // tiny on purpose
    const { controller, prisma } = build(createInMemoryPrisma());
    const userId = randomUUID();
    const conversationId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
    prisma.conversations.push({
      id: conversationId,
      userId,
      title: 't',
      createdAt: new Date(),
      lastMessageAt: new Date(),
    });
    // 5 messages of ~50 tokens each (200 chars / 4). With budget=100, keep
    // last 2, drop the older 3.
    for (let i = 0; i < 5; i++) {
      prisma.messages.push({
        id: randomUUID(),
        conversationId,
        userId,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'a'.repeat(200),
        status: 'complete',
        createdAt: new Date(Date.now() - (5 - i) * 1000),
        completedAt: new Date(),
      });
    }
    const res = await controller.listMessages(req(userId), conversationId);
    expect(res.messages).toHaveLength(5);
    expect(res.omittedCount).toBe(3);
  });
});
