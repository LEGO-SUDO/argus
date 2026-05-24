// Integration-test helper: boots an ephemeral Postgres via @testcontainers/postgresql,
// applies the Prisma migration, and exposes a fresh PrismaClient bound to it.
//
// Skips the suite cleanly when Docker is unavailable (CI without docker-in-docker
// or local dev without Docker Desktop). Skipping is loud — Jest logs "SKIPPED:
// docker unavailable" so the gap is visible.
import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

export interface IntegrationEnv {
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

export async function bootIntegrationEnv(): Promise<IntegrationEnv> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('argus_test')
    .withUsername('argus')
    .withPassword('argus')
    .start();
  const databaseUrl = container.getConnectionUri();

  // Apply committed migrations via Prisma's own deploy runner. Feeding raw
  // multi-statement migration.sql files through `$executeRawUnsafe` fails on
  // Postgres ("cannot insert multiple commands into a prepared statement"),
  // so we shell out to `prisma migrate deploy` which applies each migration
  // statement-by-statement exactly as prod deploy does.
  execSync('pnpm --filter @argus/db exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  return { prisma, container, databaseUrl };
}

export async function tearDownIntegrationEnv(env: IntegrationEnv): Promise<void> {
  await env.prisma.$disconnect();
  await env.container.stop();
}
