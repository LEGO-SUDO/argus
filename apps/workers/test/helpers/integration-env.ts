// Integration-test helper: boots an ephemeral Postgres via @testcontainers/postgresql,
// applies the Prisma migration, and exposes a fresh PrismaClient bound to it.
//
// Skips the suite cleanly when Docker is unavailable (CI without docker-in-docker
// or local dev without Docker Desktop). Skipping is loud — Jest logs "SKIPPED:
// docker unavailable" so the gap is visible.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

export interface IntegrationEnv {
  prisma: PrismaClient;
  container: StartedPostgreSqlContainer;
  databaseUrl: string;
}

const MIGRATIONS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'prisma',
  'migrations',
);

export function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function listMigrationFiles(): string[] {
  // Each migration is a sibling directory under migrations/ containing
  // migration.sql. We apply in lexicographic order so 0001_init runs before
  // 0002_inference_trace_index, etc.
  const entries = readdirSync(MIGRATIONS_DIR);
  const dirs = entries
    .filter((name) => {
      const full = join(MIGRATIONS_DIR, name);
      return statSync(full).isDirectory();
    })
    .sort();
  return dirs.map((d) => join(MIGRATIONS_DIR, d, 'migration.sql'));
}

// Postgres' extended-query protocol (which Prisma's `$executeRawUnsafe` uses)
// rejects multiple commands in a single call: "cannot insert multiple commands
// into a prepared statement". A whole migration.sql file is many statements, so
// we split it and run each one separately. Our migrations are plain DDL with no
// dollar-quoting / function bodies, so splitting on `;` is safe. Chunks that are
// only comments or whitespace (e.g. a trailing comment after the last `;`) are
// dropped — leading `-- ` comment lines on a real statement are harmless
// (Postgres ignores them).
export function splitSqlStatements(sql: string): string[] {
  // Drop full-line `--` comments BEFORE splitting on `;`. A comment may itself
  // contain a semicolon (e.g. "-- ... (trace_id, span_id); without this index")
  // which would otherwise be read as a false statement boundary. Prisma keeps
  // comments on their own lines, so dropping whole comment lines is sufficient
  // and avoids slicing a `--` that might appear inside a quoted literal.
  const code = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return code
    .split(';')
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

export async function bootIntegrationEnv(): Promise<IntegrationEnv> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('argus_test')
    .withUsername('argus')
    .withPassword('argus')
    .start();
  const databaseUrl = container.getConnectionUri();

  // Apply every committed migration in order. We use the raw migration SQL
  // the project commits so the test exercises the same DDL Prisma will
  // deploy in prod. (PR #7's canonical approach — split multi-statement
  // migration.sql on `;` and run each statement separately, since Postgres'
  // extended-query protocol rejects multiple commands per call. Phase B's
  // migration 0003 directories are picked up here in lexicographic order.)
  const adminPrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  for (const file of listMigrationFiles()) {
    const sql = readFileSync(file, 'utf8');
    for (const statement of splitSqlStatements(sql)) {
      await adminPrisma.$executeRawUnsafe(statement);
    }
  }
  await adminPrisma.$disconnect();

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  return { prisma, container, databaseUrl };
}

export async function tearDownIntegrationEnv(env: IntegrationEnv): Promise<void> {
  await env.prisma.$disconnect();
  await env.container.stop();
}
