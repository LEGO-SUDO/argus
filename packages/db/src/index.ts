// @argus/db — Prisma schema + thin client wrapper.
//
// Lazily-instantiated PrismaClient singleton (one per Node process).
// In dev with hot-reload, we cache on globalThis so each module reload does
// not spin up a new connection pool. In prod, the module is loaded once.
import { PrismaClient, Prisma } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __argusPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient =
  globalThis.__argusPrisma ?? (globalThis.__argusPrisma = createClient());

// Re-export generated types so call sites do not depend on @prisma/client
// directly — keeps the workspace surface tied to @argus/db.
export {
  PrismaClient,
  Prisma,
};
export type {
  User,
  Session,
  Conversation,
  Message,
  Inference,
  TraceEvent,
  MessageStatus,
  InferenceStatus,
  // Phase B
  InferenceKind,
  SampleWorkspace,
  UserClearFence,
} from '@prisma/client';
