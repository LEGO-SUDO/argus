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

  // chat-context-and-ux-polish LLD Tasks 74/75.
  describe('update (generalized patch)', () => {
    it('accepts a title-only patch and persists exactly that column', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const a = await seedUserWithConversations(prisma, 1);
      const ok = await repo.update(a.convIds[0]!, a.userId, { title: 'renamed' });
      expect(ok).toBe(true);
      const row = await repo.getByIdForUser(a.convIds[0]!, a.userId);
      expect(row!.title).toBe('renamed');
    });

    it('accepts both pin columns and persists them', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const a = await seedUserWithConversations(prisma, 1);
      const ok = await repo.update(a.convIds[0]!, a.userId, {
        pinnedProvider: 'anthropic',
        pinnedModel: 'claude-haiku-4-5',
      });
      expect(ok).toBe(true);
      const row = (await repo.getByIdForUser(a.convIds[0]!, a.userId))!;
      expect(row.pinnedProvider).toBe('anthropic');
      expect(row.pinnedModel).toBe('claude-haiku-4-5');
    });

    it('clears the pin when both fields are null', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const a = await seedUserWithConversations(prisma, 1);
      await repo.update(a.convIds[0]!, a.userId, {
        pinnedProvider: 'anthropic',
        pinnedModel: 'claude-haiku-4-5',
      });
      const ok = await repo.update(a.convIds[0]!, a.userId, {
        pinnedProvider: null,
        pinnedModel: null,
      });
      expect(ok).toBe(true);
      const row = (await repo.getByIdForUser(a.convIds[0]!, a.userId))!;
      expect(row.pinnedProvider).toBeNull();
      expect(row.pinnedModel).toBeNull();
    });

    it('returns true on an empty-patch no-op when the row exists for the user', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const a = await seedUserWithConversations(prisma, 1);
      const ok = await repo.update(a.convIds[0]!, a.userId, {});
      expect(ok).toBe(true);
    });

    it('returns false when the row is owned by a different user (preserves authz)', async () => {
      const prisma = createInMemoryPrisma();
      const repo = build(prisma);
      const a = await seedUserWithConversations(prisma, 1);
      const b = await seedUserWithConversations(prisma, 0);
      const ok = await repo.update(a.convIds[0]!, b.userId, { title: 'evil' });
      expect(ok).toBe(false);
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
