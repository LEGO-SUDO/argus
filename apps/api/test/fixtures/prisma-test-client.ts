// In-memory Prisma test client.
//
// The unit tests in this LLD exercise repositories and services without
// requiring a live Postgres. We replicate the narrow surface of PrismaClient
// the api code actually calls — `user.{create,findUnique,upsert}`,
// `session.{create,delete,findFirst,deleteMany}`,
// `conversation.{create,findMany,findFirst,update,updateMany,deleteMany,delete}`,
// `message.{create,findMany,findFirst,update,updateMany}`,
// `inference.{create,findFirst,findMany}`, `$transaction`, `$queryRaw`.
//
// Anything beyond what's defined here will throw — keeping the surface tight
// makes regressions visible. For full schema coverage we lean on the workers'
// testcontainers-backed integration suite.
import { randomUUID } from 'crypto';

type Status = 'streaming' | 'complete' | 'canceled' | 'failed';
type InferenceStatus = 'streaming' | 'ok' | 'failed' | 'canceled';

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ConversationRow {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  lastMessageAt: Date | null;
  // chat-context-and-ux-polish LLD Task 35 — pin columns. Optional here so
  // tests that push rows without pins keep working; production Prisma reads
  // these as nullable text.
  pinnedProvider?: string | null;
  pinnedModel?: string | null;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  userId: string;
  role: string;
  content: string;
  status: Status;
  createdAt: Date;
  completedAt: Date | null;
}

export interface InferenceRow {
  id: string;
  messageId: string;
  conversationId: string;
  userId: string;
  provider: string;
  model: string;
  status: InferenceStatus;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  promptCostUsdMicros: number | null;
  completionCostUsdMicros: number | null;
  startedAt: Date;
  endedAt: Date | null;
  inputPreview: string | null;
  outputPreview: string | null;
  traceId: string | null;
  spanId: string | null;
  errorCode: string | null;
}

interface UniqueViolation extends Error {
  code: 'P2002';
  meta: { target: string[] };
}

function uniqueViolation(target: string[]): UniqueViolation {
  const err = new Error('Unique constraint failed') as UniqueViolation;
  err.code = 'P2002';
  err.meta = { target };
  return err;
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x, (_k, v) => (v instanceof Date ? v.toISOString() : v)), (_k, v) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v,
  );
}

// Filter operator support is intentionally narrow — only what the api code
// actually uses. `{ in: [...] }` was added for MessagesRepository.listForConversation
// which batches per-message inferences lookups.
type ScalarOrFilter = string | { in?: string[] } | undefined;

interface Where {
  id?: ScalarOrFilter;
  userId?: ScalarOrFilter;
  conversationId?: ScalarOrFilter;
  messageId?: ScalarOrFilter;
  email?: ScalarOrFilter;
  tokenHash?: ScalarOrFilter;
  // chat-context-and-ux-polish LLD Task 53 — ChatService.startTurn filters
  // history by `status: { in: ['complete', 'canceled', 'failed'] }` to drop
  // streaming rows. Mirror the operator surface here so the InMemoryPrisma
  // matches what Prisma's runtime accepts.
  status?: ScalarOrFilter;
  AND?: Where[];
}

function matches<T extends Record<string, unknown>>(row: T, where: Where): boolean {
  if (where.AND) {
    return where.AND.every((w) => matches(row, w));
  }
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    const rowVal = (row as Record<string, unknown>)[k];
    if (v !== null && typeof v === 'object' && 'in' in v && Array.isArray(v.in)) {
      if (!v.in.includes(rowVal as string)) return false;
      continue;
    }
    if (rowVal !== v) return false;
  }
  return true;
}

export class InMemoryPrisma {
  users: UserRow[] = [];
  sessions: SessionRow[] = [];
  conversations: ConversationRow[] = [];
  messages: MessageRow[] = [];
  inferences: InferenceRow[] = [];

  user = {
    create: async (args: { data: { email: string; passwordHash: string; id?: string } }): Promise<UserRow> => {
      if (this.users.some((u) => u.email === args.data.email)) {
        throw uniqueViolation(['email']);
      }
      const row: UserRow = {
        id: args.data.id ?? randomUUID(),
        email: args.data.email,
        passwordHash: args.data.passwordHash,
        createdAt: new Date(),
      };
      this.users.push(row);
      return clone(row);
    },
    findUnique: async (args: { where: { email?: string; id?: string } }): Promise<UserRow | null> => {
      const row = this.users.find((u) =>
        args.where.email !== undefined ? u.email === args.where.email : u.id === args.where.id,
      );
      return row ? clone(row) : null;
    },
    upsert: async (args: {
      where: { email: string };
      create: { email: string; passwordHash: string };
      update: Partial<UserRow>;
    }): Promise<UserRow> => {
      const existing = this.users.find((u) => u.email === args.where.email);
      if (existing) {
        Object.assign(existing, args.update);
        return clone(existing);
      }
      const row: UserRow = {
        id: randomUUID(),
        email: args.create.email,
        passwordHash: args.create.passwordHash,
        createdAt: new Date(),
      };
      this.users.push(row);
      return clone(row);
    },
    count: async (args?: { where?: { email?: string } }): Promise<number> => {
      if (!args?.where) return this.users.length;
      return this.users.filter((u) => matches(u, args.where as Where)).length;
    },
    deleteMany: async (): Promise<{ count: number }> => {
      const n = this.users.length;
      this.users = [];
      return { count: n };
    },
  };

  session = {
    create: async (args: {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    }): Promise<SessionRow> => {
      if (this.sessions.some((s) => s.tokenHash === args.data.tokenHash)) {
        throw uniqueViolation(['tokenHash']);
      }
      const row: SessionRow = {
        id: randomUUID(),
        userId: args.data.userId,
        tokenHash: args.data.tokenHash,
        expiresAt: args.data.expiresAt,
        createdAt: new Date(),
      };
      this.sessions.push(row);
      return clone(row);
    },
    findFirst: async (args: { where: Where }): Promise<SessionRow | null> => {
      const row = this.sessions.find((s) => matches(s, args.where));
      if (!row) return null;
      // Honor expiresAt > now if AND clause includes it (not used in our usage)
      return clone(row);
    },
    findUnique: async (args: { where: { tokenHash?: string } }): Promise<SessionRow | null> => {
      const row = this.sessions.find((s) => s.tokenHash === args.where.tokenHash);
      return row ? clone(row) : null;
    },
    update: async (args: {
      where: { id: string };
      data: Partial<SessionRow>;
    }): Promise<SessionRow> => {
      const row = this.sessions.find((s) => s.id === args.where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, args.data);
      return clone(row);
    },
    deleteMany: async (args: { where: Where }): Promise<{ count: number }> => {
      const before = this.sessions.length;
      this.sessions = this.sessions.filter((s) => !matches(s, args.where));
      return { count: before - this.sessions.length };
    },
  };

  conversation = {
    create: async (args: {
      data: { userId: string; title: string };
    }): Promise<ConversationRow> => {
      const row: ConversationRow = {
        id: randomUUID(),
        userId: args.data.userId,
        title: args.data.title,
        createdAt: new Date(),
        lastMessageAt: null,
        // chat-context-and-ux-polish LLD Task 35 — default both pin columns
        // to null on insert so reads always see a stable shape.
        pinnedProvider: null,
        pinnedModel: null,
      };
      this.conversations.push(row);
      return clone(row);
    },
    findMany: async (args: {
      where: Where;
      orderBy?: { lastMessageAt?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' };
    }): Promise<ConversationRow[]> => {
      const rows = this.conversations.filter((c) => matches(c, args.where));
      if (args.orderBy?.lastMessageAt === 'desc' || args.orderBy?.createdAt === 'desc') {
        rows.sort((a, b) => {
          const at =
            args.orderBy?.lastMessageAt !== undefined
              ? (a.lastMessageAt?.getTime() ?? a.createdAt.getTime())
              : a.createdAt.getTime();
          const bt =
            args.orderBy?.lastMessageAt !== undefined
              ? (b.lastMessageAt?.getTime() ?? b.createdAt.getTime())
              : b.createdAt.getTime();
          return bt - at;
        });
      }
      return clone(rows);
    },
    findFirst: async (args: { where: Where }): Promise<ConversationRow | null> => {
      const row = this.conversations.find((c) => matches(c, args.where));
      return row ? clone(row) : null;
    },
    update: async (args: {
      where: { id: string };
      data: Partial<ConversationRow>;
    }): Promise<ConversationRow> => {
      const row = this.conversations.find((c) => c.id === args.where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, args.data);
      return clone(row);
    },
    updateMany: async (args: {
      where: Where;
      data: Partial<ConversationRow>;
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const c of this.conversations) {
        if (matches(c, args.where)) {
          Object.assign(c, args.data);
          count++;
        }
      }
      return { count };
    },
    deleteMany: async (args: { where: Where }): Promise<{ count: number }> => {
      const before = this.conversations.length;
      this.conversations = this.conversations.filter((c) => !matches(c, args.where));
      return { count: before - this.conversations.length };
    },
    delete: async (args: { where: { id: string } }): Promise<ConversationRow> => {
      const idx = this.conversations.findIndex((c) => c.id === args.where.id);
      if (idx < 0) throw new Error('record not found');
      const [removed] = this.conversations.splice(idx, 1);
      return clone(removed!);
    },
  };

  message = {
    create: async (args: {
      data: Omit<MessageRow, 'createdAt' | 'completedAt'> & {
        createdAt?: Date;
        completedAt?: Date | null;
      };
    }): Promise<MessageRow> => {
      const row: MessageRow = {
        id: args.data.id,
        conversationId: args.data.conversationId,
        userId: args.data.userId,
        role: args.data.role,
        content: args.data.content,
        status: args.data.status,
        createdAt: args.data.createdAt ?? new Date(),
        completedAt: args.data.completedAt ?? null,
      };
      this.messages.push(row);
      return clone(row);
    },
    findMany: async (args: {
      where: Where;
      orderBy?: { createdAt?: 'asc' | 'desc' };
    }): Promise<MessageRow[]> => {
      const rows = this.messages.filter((m) => matches(m, args.where));
      if (args.orderBy?.createdAt === 'asc') {
        rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      } else if (args.orderBy?.createdAt === 'desc') {
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return clone(rows);
    },
    findFirst: async (args: { where: Where }): Promise<MessageRow | null> => {
      const row = this.messages.find((m) => matches(m, args.where));
      return row ? clone(row) : null;
    },
    update: async (args: {
      where: { id: string };
      data: Partial<MessageRow>;
    }): Promise<MessageRow> => {
      const row = this.messages.find((m) => m.id === args.where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, args.data);
      return clone(row);
    },
    updateMany: async (args: {
      where: Where;
      data: Partial<MessageRow>;
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const m of this.messages) {
        if (matches(m, args.where)) {
          Object.assign(m, args.data);
          count++;
        }
      }
      return { count };
    },
  };

  inference = {
    create: async (args: {
      data: Omit<InferenceRow, 'id' | 'endedAt'> & {
        id?: string;
        endedAt?: Date | null;
      };
    }): Promise<InferenceRow> => {
      const row: InferenceRow = {
        id: args.data.id ?? randomUUID(),
        messageId: args.data.messageId,
        conversationId: args.data.conversationId,
        userId: args.data.userId,
        provider: args.data.provider,
        model: args.data.model,
        status: args.data.status,
        latencyMs: args.data.latencyMs ?? null,
        promptTokens: args.data.promptTokens ?? null,
        completionTokens: args.data.completionTokens ?? null,
        promptCostUsdMicros: args.data.promptCostUsdMicros ?? null,
        completionCostUsdMicros: args.data.completionCostUsdMicros ?? null,
        startedAt: args.data.startedAt,
        endedAt: args.data.endedAt ?? null,
        inputPreview: args.data.inputPreview ?? null,
        outputPreview: args.data.outputPreview ?? null,
        traceId: args.data.traceId ?? null,
        spanId: args.data.spanId ?? null,
        errorCode: args.data.errorCode ?? null,
      };
      this.inferences.push(row);
      return clone(row);
    },
    findFirst: async (args: { where: Where }): Promise<InferenceRow | null> => {
      const row = this.inferences.find((i) => matches(i, args.where));
      return row ? clone(row) : null;
    },
    findMany: async (args: { where: Where }): Promise<InferenceRow[]> => {
      return clone(this.inferences.filter((i) => matches(i, args.where)));
    },
    updateMany: async (args: {
      where: Where;
      data: Partial<InferenceRow>;
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const i of this.inferences) {
        if (matches(i, args.where)) {
          Object.assign(i, args.data);
          count++;
        }
      }
      return { count };
    },
  };

  // $transaction runs callback against `this` — atomicity is not modeled
  // (single-threaded JS, no concurrent writers in tests).
  async $transaction<T>(fn: (tx: InMemoryPrisma) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async $queryRaw(_strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown> {
    return [{ '?column?': 1 }];
  }

  async $connect(): Promise<void> {
    // no-op
  }

  async $disconnect(): Promise<void> {
    // no-op
  }
}

export function createInMemoryPrisma(): InMemoryPrisma {
  return new InMemoryPrisma();
}
