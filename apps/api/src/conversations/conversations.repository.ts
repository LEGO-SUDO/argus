// User-scoped persistence for conversations.
//
// Every public method takes `userId` as an explicit parameter and filters on
// it inside the Prisma where clause. The authorization-filter test
// (apps/api/test/common/authorization.filter.test.ts) enumerates these
// methods reflectively and fails if a new one is added without ownership
// filtering — see ./README in spirit.
//
// chat-context-and-ux-polish backbone (LLD Task 75): rename → update,
// generalized to accept a partial patch (title and/or pin columns).
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface ConversationRow {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  lastMessageAt: Date | null;
  // chat-context-and-ux-polish LLD Task 35/75 — pin columns. Both nullable;
  // optional here only because legacy data sites that pre-date the backbone
  // (e.g. tests pushing rows by hand) may not include them, in which case
  // Prisma reads them as null.
  pinnedProvider?: string | null;
  pinnedModel?: string | null;
}

/** Partial patch shape accepted by `update` — any subset of the writable cols. */
export interface ConversationUpdatePatch {
  title?: string;
  pinnedProvider?: string | null;
  pinnedModel?: string | null;
}

@Injectable()
export class ConversationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<ConversationRow[]> {
    return this.prisma.db.conversation.findMany({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  async getByIdForUser(id: string, userId: string): Promise<ConversationRow | null> {
    return this.prisma.db.conversation.findFirst({
      where: { id, userId },
    });
  }

  async create(userId: string, title: string): Promise<ConversationRow> {
    return this.prisma.db.conversation.create({
      data: { userId, title },
    });
  }

  /**
   * Generalized update — accepts a partial patch (title and/or pin columns).
   *
   * chat-context-and-ux-polish LLD Task 75:
   *   - Persists exactly the columns named in the patch (no partial writes
   *     on rejected combos — the controller validates first).
   *   - Preserves the per-user authorization filter (updateMany over the
   *     ownership clause). Returns true iff a row was matched + updated.
   *   - Empty patch is a no-op (returns true iff the row exists & is owned
   *     by the caller).
   */
  async update(
    id: string,
    userId: string,
    patch: ConversationUpdatePatch,
  ): Promise<boolean> {
    // Build the data object explicitly from the patch so we never let an
    // unintended field land in the update (the patch type is structural but
    // a caller could shove extras in via casting; this is defensive).
    const data: Record<string, string | null> = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'title') && patch.title !== undefined) {
      data.title = patch.title;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'pinnedProvider')) {
      data.pinnedProvider = patch.pinnedProvider ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'pinnedModel')) {
      data.pinnedModel = patch.pinnedModel ?? null;
    }
    if (Object.keys(data).length === 0) {
      // No writable fields — treat as a successful no-op iff the row exists
      // for this user. Avoids surfacing a "not found" when the caller sent
      // an empty PATCH body.
      const exists = await this.prisma.db.conversation.findFirst({
        where: { id, userId },
      });
      return exists !== null;
    }
    const result = await this.prisma.db.conversation.updateMany({
      where: { id, userId },
      data,
    });
    return result.count > 0;
  }

  /** Back-compat shim — title-only rename. Delegates to update(). */
  async rename(id: string, userId: string, title: string): Promise<boolean> {
    return this.update(id, userId, { title });
  }

  /**
   * Returns true when a row was deleted, false when no row matched.
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.prisma.db.conversation.deleteMany({
      where: { id, userId },
    });
    return result.count > 0;
  }
}
