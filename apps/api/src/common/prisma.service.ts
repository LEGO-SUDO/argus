// PrismaService — Nest DI wrapper around the @argus/db client singleton.
//
// The client itself is the workspace-global singleton from packages/db (one
// pool per process, hot-reload safe). This service exists so Nest controllers
// + repositories can inject `PrismaService` instead of importing a top-level
// const — which keeps tests injectable (we substitute an InMemoryPrisma).
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { PrismaClient } from '@argus/db';

export const PRISMA_CLIENT_TOKEN = Symbol('PRISMA_CLIENT');

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor(@Optional() @Inject(PRISMA_CLIENT_TOKEN) injected?: PrismaClient) {
    if (injected) {
      this.client = injected;
    } else {
      // Lazy require so unit tests can inject a stub without ever loading
      // @prisma/client (which fails when generate hasn't been run).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { prisma } = require('@argus/db') as { prisma: PrismaClient };
      this.client = prisma;
    }
  }

  get db(): PrismaClient {
    return this.client;
  }

  async onModuleInit(): Promise<void> {
    // PrismaClient connects lazily on first query — no-op here, but keep the
    // hook so we can wire health checks later.
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.$disconnect();
    } catch {
      // Suppress shutdown errors — we're tearing down anyway.
    }
  }
}
