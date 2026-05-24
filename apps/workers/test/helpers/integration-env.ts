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

export async function bootIntegrationEnv(): Promise<IntegrationEnv> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('argus_test')
    .withUsername('argus')
    .withPassword('argus')
    .start();
  const databaseUrl = container.getConnectionUri();

  // Apply every committed migration in order. We use the raw migration SQL
  // the project commits so the test exercises the same DDL Prisma will
  // deploy in prod.
  const adminPrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  for (const file of listMigrationFiles()) {
    const sql = readFileSync(file, 'utf8');
    await adminPrisma.$executeRawUnsafe(sql);
  }
  await adminPrisma.$disconnect();

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  return { prisma, container, databaseUrl };
}

export async function tearDownIntegrationEnv(env: IntegrationEnv): Promise<void> {
  await env.prisma.$disconnect();
  await env.container.stop();
}
