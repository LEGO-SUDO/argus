// In-memory Prisma test client.
//
// The unit tests in this LLD exercise repositories and services without
// requiring a live Postgres. We replicate the narrow surface of PrismaClient
// the api code actually calls. Phase B (control plane) widens the surface:
//   - inferences gains `kind`, `classifierForMessageId`, `replayOfInferenceId`,
//     `sampleWorkspaceId`, `updatedAt`, plus `count` / `deleteMany` / `update`.
//   - new delegates: `sampleWorkspace`, `userClearFence`, `traceEvent`.
//   - `session` gains `currentSampleWorkspaceId` + `findMany` / `updateMany`.
//   - the `where` matcher gains operator support (`lt|lte|gt|gte|not|in|
//     contains+mode|equals`, nested `AND`/`OR`) and `findMany` gains
//     `orderBy` (single or array) + `take`, so repositories paginate / filter
//     with portable Prisma queries the in-memory store can execute.
//
// Anything beyond what's defined here will throw — keeping the surface tight
// makes regressions visible. For full schema coverage we lean on the workers'
// testcontainers-backed integration suite.
import { randomUUID } from 'crypto';

type Status = 'streaming' | 'complete' | 'canceled' | 'failed';
type InferenceStatus = 'streaming' | 'ok' | 'failed' | 'canceled';
export type InferenceKind = 'chat' | 'classifier' | 'replay' | 'sample' | 'heartbeat' | 'unknown';

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
  currentSampleWorkspaceId: string | null;
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
  kind: InferenceKind;
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
  classifierForMessageId: string | null;
  replayOfInferenceId: string | null;
  sampleWorkspaceId: string | null;
  updatedAt: Date;
}

export interface TraceEventRow {
  id: string;
  traceId: string;
  spanId: string;
  messageId: string | null;
  userId: string | null;
  name: string;
  payload: unknown;
  truncated: boolean;
  kind: InferenceKind | null;
  createdAt: Date;
}

export interface SampleWorkspaceRow {
  id: string;
  userId: string;
  createdAt: Date;
}

export interface UserClearFenceRow {
  userId: string;
  clearAfterTs: Date;
  updatedAt: Date;
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

// ---------------------------------------------------------------------------
// where matcher — operator-aware, recursive (AND/OR), with comparison support
// over Dates and scalars. Only the subset the api code uses is implemented.
// ---------------------------------------------------------------------------

function toComparable(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

function scalarEq(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    if (a == null || b == null) return a === b;
    return toComparable(a) === toComparable(b);
  }
  return a === b;
}

// Ordered comparison usable for Dates, numbers, and plain strings (UUIDs sort
// lexicographically — matching how Postgres orders text/uuid for cursor pages).
function cmp(a: unknown, b: unknown): number {
  const an = toComparable(a);
  const bn = toComparable(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function valueMatches(rowVal: unknown, filter: unknown): boolean {
  if (filter === null) return rowVal === null || rowVal === undefined;
  if (filter instanceof Date) return scalarEq(rowVal, filter);
  if (typeof filter !== 'object') return scalarEq(rowVal, filter);

  const f = filter as Record<string, unknown>;
  if ('equals' in f && !valueMatches(rowVal, f.equals)) return false;
  if ('not' in f) {
    const n = f.not;
    if (n === null) {
      if (rowVal === null || rowVal === undefined) return false;
    } else if (scalarEq(rowVal, n)) {
      return false;
    }
  }
  if ('in' in f && Array.isArray(f.in)) {
    if (!f.in.some((x) => scalarEq(rowVal, x))) return false;
  }
  if ('lt' in f && !(cmp(rowVal, f.lt) < 0)) return false;
  if ('lte' in f && !(cmp(rowVal, f.lte) <= 0)) return false;
  if ('gt' in f && !(cmp(rowVal, f.gt) > 0)) return false;
  if ('gte' in f && !(cmp(rowVal, f.gte) >= 0)) return false;
  if ('contains' in f) {
    const hay = String(rowVal ?? '');
    const needle = String(f.contains);
    if (f.mode === 'insensitive') {
      if (!hay.toLowerCase().includes(needle.toLowerCase())) return false;
    } else if (!hay.includes(needle)) {
      return false;
    }
  }
  return true;
}

type Where = Record<string, unknown> & { AND?: Where[]; OR?: Where[] };

function matches<T extends Record<string, unknown>>(row: T, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'AND') {
      if (!(v as Where[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (k === 'OR') {
      if (!(v as Where[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (!valueMatches((row as Record<string, unknown>)[k], v)) return false;
  }
  return true;
}

type OrderBy = Record<string, 'asc' | 'desc'>;

function applyOrderBy<T extends Record<string, unknown>>(rows: T[], orderBy?: OrderBy | OrderBy[]): T[] {
  if (!orderBy) return rows;
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  out.sort((a, b) => {
    for (const spec of keys) {
      for (const [field, dir] of Object.entries(spec)) {
        const av = (a as Record<string, unknown>)[field];
        const bv = (b as Record<string, unknown>)[field];
        const an = toComparable(av);
        const bn = toComparable(bv);
        let cmp: number;
        if (!Number.isNaN(an) && !Number.isNaN(bn)) cmp = an - bn;
        else cmp = String(av ?? '').localeCompare(String(bv ?? ''));
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
      }
    }
    return 0;
  });
  return out;
}

interface FindManyArgs {
  where?: Where;
  orderBy?: OrderBy | OrderBy[];
  take?: number;
}

export class InMemoryPrisma {
  users: UserRow[] = [];
  sessions: SessionRow[] = [];
  conversations: ConversationRow[] = [];
  messages: MessageRow[] = [];
  inferences: InferenceRow[] = [];
  traceEvents: TraceEventRow[] = [];
  sampleWorkspaces: SampleWorkspaceRow[] = [];
  userClearFences: UserClearFenceRow[] = [];

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
    count: async (args?: { where?: Where }): Promise<number> => {
      if (!args?.where) return this.users.length;
      return this.users.filter((u) => matches(u, args.where)).length;
    },
    deleteMany: async (): Promise<{ count: number }> => {
      const n = this.users.length;
      this.users = [];
      return { count: n };
    },
  };

  session = {
    create: async (args: {
      data: { userId: string; tokenHash: string; expiresAt: Date; currentSampleWorkspaceId?: string | null };
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
        currentSampleWorkspaceId: args.data.currentSampleWorkspaceId ?? null,
      };
      this.sessions.push(row);
      return clone(row);
    },
    findFirst: async (args: { where: Where }): Promise<SessionRow | null> => {
      const row = this.sessions.find((s) => matches(s, args.where));
      return row ? clone(row) : null;
    },
    findUnique: async (args: { where: { tokenHash?: string } }): Promise<SessionRow | null> => {
      const row = this.sessions.find((s) => s.tokenHash === args.where.tokenHash);
      return row ? clone(row) : null;
    },
    findMany: async (args: FindManyArgs): Promise<SessionRow[]> => {
      const rows = this.sessions.filter((s) => matches(s, args.where));
      return clone(applyOrderBy(rows, args.orderBy));
    },
    update: async (args: { where: { id: string }; data: Partial<SessionRow> }): Promise<SessionRow> => {
      const row = this.sessions.find((s) => s.id === args.where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, args.data);
      return clone(row);
    },
    updateMany: async (args: { where: Where; data: Partial<SessionRow> }): Promise<{ count: number }> => {
      let count = 0;
      for (const s of this.sessions) {
        if (matches(s, args.where)) {
          Object.assign(s, args.data);
          count++;
        }
      }
      return { count };
    },
    deleteMany: async (args: { where: Where }): Promise<{ count: number }> => {
      const before = this.sessions.length;
      this.sessions = this.sessions.filter((s) => !matches(s, args.where));
      return { count: before - this.sessions.length };
    },
  };

  conversation = {
    create: async (args: { data: { userId: string; title: string } }): Promise<ConversationRow> => {
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
    update: async (args: { where: { id: string }; data: Partial<ConversationRow> }): Promise<ConversationRow> => {
      const row = this.conversations.find((c) => c.id === args.where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, args.data);
      return clone(row);
    },
    updateMany: async (args: { where: Where; data: Partial<ConversationRow> }): Promise<{ count: number }> => {
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
      data: Omit<MessageRow, 'createdAt' | 'completedAt'> & { createdAt?: Date; completedAt?: Date | null };
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
    findMany: async (args: { where: Where; orderBy?: OrderBy | OrderBy[] }): Promise<MessageRow[]> => {
      const rows = this.messages.filter((m) => matches(m, args.where));
      return clone(applyOrderBy(rows, args.orderBy));
    },
    findFirst: async (args: { where: Where }): Promise<MessageRow | null> => {
      const row = this.messages.find((m) => matches(m, args.where));
      return row ? clone(row) : null;
    },
    update: async (args: { where: { id: string }; data: Partial<MessageRow> }): Promise<MessageRow> => {
      const row = this.messages.find((m) => m.id === args.where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, args.data);
      return clone(row);
    },
    updateMany: async (args: { where: Where; data: Partial<MessageRow> }): Promise<{ count: number }> => {
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
      data: Omit<InferenceRow, 'id' | 'endedAt' | 'kind' | 'updatedAt'> & {
        id?: string;
        endedAt?: Date | null;
        kind?: InferenceKind;
        latencyMs?: number | null;
        promptTokens?: number | null;
        completionTokens?: number | null;
        promptCostUsdMicros?: number | null;
        completionCostUsdMicros?: number | null;
        inputPreview?: string | null;
        outputPreview?: string | null;
        traceId?: string | null;
        spanId?: string | null;
        errorCode?: string | null;
        classifierForMessageId?: string | null;
        replayOfInferenceId?: string | null;
        sampleWorkspaceId?: string | null;
        updatedAt?: Date;
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
        kind: args.data.kind ?? 'chat',
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
        classifierForMessageId: args.data.classifierForMessageId ?? null,
        replayOfInferenceId: args.data.replayOfInferenceId ?? null,
        sampleWorkspaceId: args.data.sampleWorkspaceId ?? null,
        updatedAt: args.data.updatedAt ?? args.data.startedAt ?? new Date(),
      };
      this.inferences.push(row);
      return clone(row);
    },
    findFirst: async (args: { where: Where }): Promise<InferenceRow | null> => {
      const row = this.inferences.find((i) => matches(i, args.where));
      return row ? clone(row) : null;
    },
    findMany: async (args: FindManyArgs): Promise<InferenceRow[]> => {
      let rows = this.inferences.filter((i) => matches(i, args.where));
      rows = applyOrderBy(rows, args.orderBy);
      if (typeof args.take === 'number') rows = rows.slice(0, args.take);
      return clone(rows);
    },
    count: async (args?: { where?: Where }): Promise<number> => {
      return this.inferences.filter((i) => matches(i, args?.where)).length;
    },
    update: async (args: { where: { id: string }; data: Partial<InferenceRow> }): Promise<InferenceRow> => {
      const row = this.inferences.find((i) => i.id === args.where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, args.data);
      return clone(row);
    },
    updateMany: async (args: { where: Where; data: Partial<InferenceRow> }): Promise<{ count: number }> => {
      let count = 0;
      for (const i of this.inferences) {
        if (matches(i, args.where)) {
          Object.assign(i, args.data);
          count++;
        }
      }
      return { count };
    },
    deleteMany: async (args: { where: Where }): Promise<{ count: number }> => {
      const before = this.inferences.length;
      this.inferences = this.inferences.filter((i) => !matches(i, args.where));
      return { count: before - this.inferences.length };
    },
  };

  traceEvent = {
    create: async (args: {
      data: Omit<TraceEventRow, 'id' | 'createdAt' | 'truncated' | 'kind' | 'messageId' | 'userId'> & {
        id?: string;
        createdAt?: Date;
        truncated?: boolean;
        kind?: InferenceKind | null;
        messageId?: string | null;
        userId?: string | null;
      };
    }): Promise<TraceEventRow> => {
      const row: TraceEventRow = {
        id: args.data.id ?? randomUUID(),
        traceId: args.data.traceId,
        spanId: args.data.spanId,
        messageId: args.data.messageId ?? null,
        userId: args.data.userId ?? null,
        name: args.data.name,
        payload: args.data.payload ?? null,
        truncated: args.data.truncated ?? false,
        kind: args.data.kind ?? null,
        createdAt: args.data.createdAt ?? new Date(),
      };
      this.traceEvents.push(row);
      return clone(row);
    },
    findMany: async (args: FindManyArgs): Promise<TraceEventRow[]> => {
      let rows = this.traceEvents.filter((t) => matches(t, args.where));
      rows = applyOrderBy(rows, args.orderBy);
      if (typeof args.take === 'number') rows = rows.slice(0, args.take);
      return clone(rows);
    },
    count: async (args?: { where?: Where }): Promise<number> => {
      return this.traceEvents.filter((t) => matches(t, args?.where)).length;
    },
    aggregate: async (args: {
      where?: Where;
      _max?: { createdAt?: true };
      _count?: true;
    }): Promise<{ _max?: { createdAt: Date | null }; _count?: number }> => {
      const rows = this.traceEvents.filter((t) => matches(t, args.where));
      const out: { _max?: { createdAt: Date | null }; _count?: number } = {};
      if (args._max?.createdAt) {
        const max = rows.reduce<Date | null>(
          (acc, r) => (acc === null || r.createdAt.getTime() > acc.getTime() ? r.createdAt : acc),
          null,
        );
        out._max = { createdAt: max };
      }
      if (args._count) out._count = rows.length;
      return clone(out);
    },
    deleteMany: async (args: { where: Where }): Promise<{ count: number }> => {
      const before = this.traceEvents.length;
      this.traceEvents = this.traceEvents.filter((t) => !matches(t, args.where));
      return { count: before - this.traceEvents.length };
    },
  };

  sampleWorkspace = {
    create: async (args: { data: { id?: string; userId: string; createdAt?: Date } }): Promise<SampleWorkspaceRow> => {
      const row: SampleWorkspaceRow = {
        id: args.data.id ?? randomUUID(),
        userId: args.data.userId,
        createdAt: args.data.createdAt ?? new Date(),
      };
      this.sampleWorkspaces.push(row);
      return clone(row);
    },
    findFirst: async (args: { where: Where }): Promise<SampleWorkspaceRow | null> => {
      const row = this.sampleWorkspaces.find((w) => matches(w, args.where));
      return row ? clone(row) : null;
    },
    findMany: async (args: FindManyArgs): Promise<SampleWorkspaceRow[]> => {
      const rows = this.sampleWorkspaces.filter((w) => matches(w, args.where));
      return clone(applyOrderBy(rows, args.orderBy));
    },
    delete: async (args: { where: { id: string } }): Promise<SampleWorkspaceRow> => {
      const idx = this.sampleWorkspaces.findIndex((w) => w.id === args.where.id);
      if (idx < 0) throw new Error('record not found');
      const [removed] = this.sampleWorkspaces.splice(idx, 1);
      return clone(removed!);
    },
  };

  userClearFence = {
    upsert: async (args: {
      where: { userId: string };
      create: { userId: string; clearAfterTs: Date };
      update: { clearAfterTs: Date };
    }): Promise<UserClearFenceRow> => {
      const existing = this.userClearFences.find((f) => f.userId === args.where.userId);
      if (existing) {
        existing.clearAfterTs = args.update.clearAfterTs;
        existing.updatedAt = new Date();
        return clone(existing);
      }
      const row: UserClearFenceRow = {
        userId: args.create.userId,
        clearAfterTs: args.create.clearAfterTs,
        updatedAt: new Date(),
      };
      this.userClearFences.push(row);
      return clone(row);
    },
    findUnique: async (args: { where: { userId: string } }): Promise<UserClearFenceRow | null> => {
      const row = this.userClearFences.find((f) => f.userId === args.where.userId);
      return row ? clone(row) : null;
    },
    delete: async (args: { where: { userId: string } }): Promise<UserClearFenceRow> => {
      const idx = this.userClearFences.findIndex((f) => f.userId === args.where.userId);
      if (idx < 0) throw new Error('record not found');
      const [removed] = this.userClearFences.splice(idx, 1);
      return clone(removed!);
    },
  };

  // chat-context-and-ux-polish (Codex review — concurrent-sends history
  // contamination). Real Postgres transactions are isolated: a transaction's
  // reads do not see another in-flight transaction's uncommitted writes. The
  // previous fixture ran the callback against `this` immediately, so two
  // `Promise.all`'d transactions interleaved their awaited writes and reads —
  // the opposite of what Postgres does, making the contamination bug invisible
  // to tests. We model the relevant guarantee (no interleaving of one
  // transaction's body with another's) by SERIALIZING transactions through a
  // promise chain. A transaction body runs to completion before the next one
  // starts, so a read inside the transaction sees only its own writes plus
  // those of transactions that fully committed before it began.
  //
  // Phase B (control plane) note: all Phase B services ($transaction callers in
  // clear/samples) use the callback form only — no array form is needed, so
  // the callback-only serialized signature covers every current caller.
  private txChain: Promise<unknown> = Promise.resolve();

  async $transaction<T>(fn: (tx: InMemoryPrisma) => Promise<T>): Promise<T> {
    const run = this.txChain.then(() => fn(this));
    // Keep the chain alive even if a transaction body rejects, so a failed
    // transaction doesn't wedge subsequent ones.
    this.txChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
