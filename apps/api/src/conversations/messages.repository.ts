// User-scoped persistence for messages.
//
// Every read filters on the denormalized `userId` column (messages carry
// user_id per the schema). The authorization-filter test verifies cross-user
// reads return null/empty.
//
// `listForConversation` enriches each row with the latest `inferences` row
// (errorCode / provider / model) so the response can hydrate MessageDto's
// optional projection fields. These live on the `inferences` table per HLD D1
// (outbox pattern — projection consumer fills them async). For assistant
// messages with failover attempts (multiple inferences sharing message_id),
// we pick the latest by `startedAt`.
//
// We fetch inferences in a separate query rather than a Prisma `include`
// because Message <-> Inference is not modeled as a Prisma relation in
// schema.prisma (inferences.message_id is a plain Uuid column with a regular
// index — schema-level join only). Two queries: one for messages, one for
// inferences filtered by `messageId in (...)`. Group + pick-latest happens in
// memory. Page sizes are bounded by the conversation history cap (HLD D6) so
// this is O(messages + inferences) without pagination risk.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface MessageRow {
  id: string;
  conversationId: string;
  userId: string;
  role: string;
  content: string;
  status: 'streaming' | 'complete' | 'canceled' | 'failed';
  createdAt: Date;
  completedAt: Date | null;
  // Hydrated from the latest `inferences` row for this message (by startedAt).
  // null when no inferences row exists yet (user messages, or assistant
  // messages whose placeholder inferences row hasn't been written — should
  // not happen in practice but the join is left-side so we tolerate it).
  errorCode: string | null;
  provider: string | null;
  model: string | null;
}

interface InferenceProjection {
  messageId: string;
  provider: string;
  model: string;
  errorCode: string | null;
  startedAt: Date;
}

@Injectable()
export class MessagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForConversation(conversationId: string, userId: string): Promise<MessageRow[]> {
    const rows = (await this.prisma.db.message.findMany({
      where: { conversationId, userId },
      orderBy: { createdAt: 'asc' },
    })) as Array<Omit<MessageRow, 'errorCode' | 'provider' | 'model'>>;

    if (rows.length === 0) return [];

    const messageIds = rows.map((r) => r.id);
    const inferences = (await this.prisma.db.inference.findMany({
      where: { messageId: { in: messageIds }, userId },
    })) as InferenceProjection[];

    // Group by messageId, pick the latest by startedAt (failover-safe).
    const latestByMessageId = new Map<string, InferenceProjection>();
    for (const inf of inferences) {
      const existing = latestByMessageId.get(inf.messageId);
      if (!existing || inf.startedAt.getTime() > existing.startedAt.getTime()) {
        latestByMessageId.set(inf.messageId, inf);
      }
    }

    return rows.map((row) => {
      const inf = latestByMessageId.get(row.id);
      return {
        ...row,
        errorCode: inf?.errorCode ?? null,
        provider: inf?.provider ?? null,
        model: inf?.model ?? null,
      };
    });
  }

  async getById(messageId: string, userId: string): Promise<MessageRow | null> {
    const row = (await this.prisma.db.message.findFirst({
      where: { id: messageId, userId },
    })) as Omit<MessageRow, 'errorCode' | 'provider' | 'model'> | null;
    if (!row) return null;
    return {
      ...row,
      errorCode: null,
      provider: null,
      model: null,
    };
  }
}
