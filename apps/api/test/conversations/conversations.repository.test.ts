// Tasks 20-25 — ConversationsRepository user-scoping.
import { ConversationsRepository } from '../../src/conversations/conversations.repository';
import { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { randomUUID } from 'crypto';

function build(prisma: InMemoryPrisma): ConversationsRepository {
  const ps = new PrismaService(prisma as never);
  return new ConversationsRepository(ps);
}

async function seedUserWithConversations(
  prisma: InMemoryPrisma,
  count: number,
): Promise<{ userId: string; convIds: string[] }> {
  const userId = randomUUID();
  prisma.users.push({ id: userId, email: `${userId}@test`, passwordHash: 'x', createdAt: new Date() });
  const convIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    prisma.conversations.push({
      id,
      userId,
      title: `c${i}`,
      createdAt: new Date(Date.now() - i * 1000),
      lastMessageAt: new Date(Date.now() - i * 500),
    });
    convIds.push(id);
  }
  return { userId, convIds };
}

describe('ConversationsRepository', () => {
  describe('listForUser', () => {
    it('returns only the calling user\'s conversations, ordered by lastMessageAt desc', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const a = await seedUserWithConversations(prisma, 3);
      const b = await seedUserWithConversations(prisma, 2);

      const aRows = await repo.listForUser(a.userId);
      expect(aRows).toHaveLength(3);
      expect(aRows.every((c) => c.userId === a.userId)).toBe(true);
      for (const row of aRows) {
        expect(b.convIds).not.toContain(row.id);
      }
      const lastMessageTimes = aRows.map((c) => c.lastMessageAt?.getTime() ?? 0);
      const sorted = [...lastMessageTimes].sort((x, y) => y - x);
      expect(lastMessageTimes).toEqual(sorted);
    });
  });

  describe('getByIdForUser', () => {
    it('returns the row when ownership matches', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const a = await seedUserWithConversations(prisma, 1);
      const row = await repo.getByIdForUser(a.convIds[0]!, a.userId);
      expect(row).not.toBeNull();
      expect(row!.id).toBe(a.convIds[0]);
    });

    it('returns null for a different user even though the id exists', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const a = await seedUserWithConversations(prisma, 1);
      const b = await seedUserWithConversations(prisma, 0);
      const row = await repo.getByIdForUser(a.convIds[0]!, b.userId);
      expect(row).toBeNull();
    });
  });

  describe('create', () => {
    it('persists with the supplied userId', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const userId = randomUUID();
      const row = await repo.create(userId, 'hello');
      expect(row.userId).toBe(userId);
      expect(row.title).toBe('hello');
    });
  });

  describe('rename', () => {
    it('updates the title only when ownership matches', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const a = await seedUserWithConversations(prisma, 1);
      const b = await seedUserWithConversations(prisma, 0);
      const okSame = await repo.rename(a.convIds[0]!, a.userId, 'renamed');
      expect(okSame).toBe(true);
      const okCross = await repo.rename(a.convIds[0]!, b.userId, 'evil rename');
      expect(okCross).toBe(false);
      const row = await repo.getByIdForUser(a.convIds[0]!, a.userId);
      expect(row!.title).toBe('renamed');
    });
  });

  describe('delete', () => {
    it('deletes only when ownership matches', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const a = await seedUserWithConversations(prisma, 2);
      const b = await seedUserWithConversations(prisma, 0);
      const okCross = await repo.delete(a.convIds[0]!, b.userId);
      expect(okCross).toBe(false);
      expect(prisma.conversations).toHaveLength(2);
      const okSame = await repo.delete(a.convIds[0]!, a.userId);
      expect(okSame).toBe(true);
      expect(prisma.conversations).toHaveLength(1);
    });
  });
});
