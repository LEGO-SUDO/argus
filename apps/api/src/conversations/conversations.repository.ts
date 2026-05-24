// User-scoped persistence for conversations.
//
// Every public method takes `userId` as an explicit parameter and filters on
// it inside the Prisma where clause. The authorization-filter test
// (apps/api/test/common/authorization.filter.test.ts) enumerates these
// methods reflectively and fails if a new one is added without ownership
// filtering — see ./README in spirit.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface ConversationRow {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  lastMessageAt: Date | null;
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
   * Returns true when a row was renamed, false when no row matched
   * (ownership mismatch or missing id).
   */
  async rename(id: string, userId: string, title: string): Promise<boolean> {
    const result = await this.prisma.db.conversation.updateMany({
      where: { id, userId },
      data: { title },
    });
    return result.count > 0;
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
