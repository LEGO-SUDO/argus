// db-package integration test harness.
//
// Boots an ephemeral Postgres via @testcontainers/postgresql, applies the
// committed Prisma migrations with `prisma migrate deploy`, and exposes a
// PrismaClient bound to it. This is a db-LOCAL copy of the pattern in
// apps/workers/test/helpers/integration-env.ts — it is intentionally NOT a
// cross-package import (package boundaries), so the db package can be tested
// in isolation.
//
// Skips cleanly when Docker is unavailable (loud SKIP so the gap is visible).
import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

export interface TestDb {
  prisma: PrismaClient;
  container: StartedPostgreSqlContainer;
  databaseUrl: string;
}

export function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Boot a fresh Postgres container, apply every committed migration, and return
 * a PrismaClient bound to the temporary database. Callers that run many cases
 * against one database should use this in `beforeAll` + `teardownTestDb` in
 * `afterAll` (one container per file). For a single self-contained block use
 * {@link withTestPrisma}.
 */
export async function bootTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('argus_test')
    .withUsername('argus')
    .withPassword('argus')
    .start();
  const databaseUrl = container.getConnectionUri();

  // Apply committed migrations via Prisma's own deploy runner — it applies each
  // statement exactly as prod deploy does (raw multi-statement $executeRawUnsafe
  // fails on Postgres with "cannot insert multiple commands into a prepared
  // statement"). Filter-scoped so cwd does not matter.
  execSync('pnpm --filter @argus/db exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  return { prisma, container, databaseUrl };
}

export async function teardownTestDb(db: TestDb): Promise<void> {
  await db.prisma.$disconnect();
  await db.container.stop();
}

/**
 * Convenience wrapper: boot a fresh migrated Postgres, hand the PrismaClient to
 * `fn`, then tear everything down (even on throw).
 */
export async function withTestPrisma<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const db = await bootTestDb();
  try {
    return await fn(db.prisma);
  } finally {
    await teardownTestDb(db);
  }
}
