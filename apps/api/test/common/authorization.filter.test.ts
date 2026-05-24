// Task 26 (RED) / 27 (GREEN) — table-driven authorization filter test.
//
// For every entry in USER_SCOPED_REPO_METHODS, seed two users with data
// owned by user A and assert calling the method with user B's id returns
// the registered "empty" sentinel (null / [] / false).
//
// Coverage guard: the test cross-checks REPOSITORY_PUBLIC_METHODS against
// USER_SCOPED_REPO_METHODS so a new repository method without a registry
// entry fails the build loudly.
import { ConversationsRepository } from '../../src/conversations/conversations.repository';
import { MessagesRepository } from '../../src/conversations/messages.repository';
import { PrismaService } from '../../src/common/prisma.service';
import {
  AUTH_FILTER_EXEMPT_METHODS,
  REPOSITORY_PUBLIC_METHODS,
  USER_SCOPED_REPO_METHODS,
  type AuthFilterContext,
  type Repos,
} from '../../src/common/authorization.filter';
import { createInMemoryPrisma } from '../fixtures/prisma-test-client';
import { randomUUID } from 'crypto';

interface Fixture {
  repos: Repos;
  userA: string;
  userB: string;
  ctx: AuthFilterContext;
}

async function buildFixture(): Promise<Fixture> {
  const prisma = createInMemoryPrisma();
  const ps = new PrismaService(prisma as never);
  const conversations = new ConversationsRepository(ps);
  const messages = new MessagesRepository(ps);

  const userA = randomUUID();
  const userB = randomUUID();
  prisma.users.push({ id: userA, email: 'a@t', passwordHash: 'x', createdAt: new Date() });
  prisma.users.push({ id: userB, email: 'b@t', passwordHash: 'x', createdAt: new Date() });

  const conversationId = randomUUID();
  prisma.conversations.push({
    id: conversationId,
    userId: userA,
    title: 'a-conv',
    createdAt: new Date(),
    lastMessageAt: new Date(),
  });

  const messageId = randomUUID();
  prisma.messages.push({
    id: messageId,
    conversationId,
    userId: userA,
    role: 'user',
    content: 'secret',
    status: 'complete',
    createdAt: new Date(),
    completedAt: new Date(),
  });

  return { repos: { conversations, messages }, userA, userB, ctx: { conversationId, messageId } };
}

function isEmpty(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null;
  if (expected === false) return actual === false;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === 0;
  return actual === expected;
}

describe('authorization filter — table-driven', () => {
  it('registry covers every public method on every user-scoped repository', () => {
    for (const [repo, methods] of Object.entries(REPOSITORY_PUBLIC_METHODS)) {
      for (const method of methods) {
        const key = `${repo}.${method}`;
        if (AUTH_FILTER_EXEMPT_METHODS.has(key)) continue;
        const found = USER_SCOPED_REPO_METHODS.find(
          (e) => e.repository === repo && e.method === method,
        );
        if (!found) {
          throw new Error(
            `Repository method ${key} is missing from USER_SCOPED_REPO_METHODS. ` +
              `Either add an authorization-filter test entry or mark it AUTH_FILTER_EXEMPT_METHODS.`,
          );
        }
      }
    }
  });

  for (const entry of USER_SCOPED_REPO_METHODS) {
    it(`${entry.repository}.${entry.method} returns empty for a different user`, async () => {
      const fixture = await buildFixture();
      const result = await entry.invoke(fixture.repos, fixture.userB, fixture.ctx);
      expect(isEmpty(result, entry.empty)).toBe(true);
    });

    it(`${entry.repository}.${entry.method} returns data for the owning user`, async () => {
      const fixture = await buildFixture();
      const result = await entry.invoke(fixture.repos, fixture.userA, fixture.ctx);
      expect(isEmpty(result, entry.empty)).toBe(false);
    });
  }
});
