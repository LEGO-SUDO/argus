// chat-context-and-ux-polish LLD Tasks 54/55 — ContextMeterService.
//
// The service consumes the SDK catalog through the Nest SDK_CATALOG token;
// tests inject a stub via the same token so we never reach into the real
// pricebook from a unit test (keeps the test resilient to pricebook drift).
import { ContextMeterService } from '../../src/chat/context-meter.service';
import { PrismaService } from '../../src/common/prisma.service';
import type { SdkCatalogAccessor } from '../../src/common/sdk-catalog.provider';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { randomUUID } from 'crypto';

const ORIGINAL_BUDGET = process.env.CONTEXT_TOKEN_BUDGET;
afterEach(() => {
  if (ORIGINAL_BUDGET === undefined) delete process.env.CONTEXT_TOKEN_BUDGET;
  else process.env.CONTEXT_TOKEN_BUDGET = ORIGINAL_BUDGET;
});

interface BuildResult {
  svc: ContextMeterService;
  prisma: InMemoryPrisma;
}

function build(catalog: Partial<SdkCatalogAccessor> = {}): BuildResult {
  const prisma = createInMemoryPrisma();
  // Default stubs — every method overridable per-test.
  const accessor: SdkCatalogAccessor = {
    listConfiguredProviders: catalog.listConfiguredProviders ?? (() => []),
    getCatalogEntry: catalog.getCatalogEntry ?? (() => null),
    // The meter only really uses `getEffectiveBudget`; default to identity.
    getEffectiveBudget:
      catalog.getEffectiveBudget ?? ((configuredDefault) => configuredDefault),
  };
  const svc = new ContextMeterService(new PrismaService(prisma as never), accessor);
  return { svc, prisma };
}

async function seedConversation(
  prisma: InMemoryPrisma,
  options: { pinnedProvider?: string | null; pinnedModel?: string | null } = {},
): Promise<{ userId: string; conversationId: string }> {
  const userId = randomUUID();
  const conversationId = randomUUID();
  prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
  // InMemoryPrisma's ConversationRow lacks pin columns by default; cast in.
  (prisma.conversations as unknown as Array<Record<string, unknown>>).push({
    id: conversationId,
    userId,
    title: 't',
    createdAt: new Date(),
    lastMessageAt: null,
    pinnedProvider: options.pinnedProvider ?? null,
    pinnedModel: options.pinnedModel ?? null,
  });
  return { userId, conversationId };
}

describe('ContextMeterService.compute', () => {
  it('returns tokensUsed = sum across messages, tokensBudget = configured default when no pin set', async () => {
    const { svc, prisma } = build({
      // Identity — no pin means no catalog lookup.
      getEffectiveBudget: (configuredDefault, pin) => {
        expect(pin).toBeUndefined();
        return configuredDefault;
      },
    });
    const { userId, conversationId } = await seedConversation(prisma);
    // 200 chars + 400 chars + 800 chars → ceil(200/4)+ceil(400/4)+ceil(800/4)
    // = 50 + 100 + 200 = 350 tokens.
    for (const len of [200, 400, 800]) {
      prisma.messages.push({
        id: randomUUID(),
        conversationId,
        userId,
        role: 'user',
        content: 'a'.repeat(len),
        status: 'complete',
        createdAt: new Date(),
        completedAt: new Date(),
      });
    }
    const out = await svc.compute({ conversationId, userId });
    expect(out.tokensUsed).toBe(350);
    expect(out.tokensBudget).toBe(10_000); // PRD default
  });

  it('returns tokensBudget capped to the pinned model window when smaller than default', async () => {
    const { svc, prisma } = build({
      getEffectiveBudget: (configuredDefault, pin) => {
        expect(pin).toEqual({ provider: 'mock', model: 'mock-1' });
        return Math.min(configuredDefault, 8192);
      },
    });
    const { userId, conversationId } = await seedConversation(prisma, {
      pinnedProvider: 'mock',
      pinnedModel: 'mock-1',
    });
    const out = await svc.compute({ conversationId, userId });
    expect(out.tokensBudget).toBe(8192);
  });

  it('returns the configured default when the pinned (provider, model) is not in the catalog (tolerance)', async () => {
    const { svc, prisma } = build({
      // Stub mimics the SDK's "unknown pin returns default" tolerance.
      getEffectiveBudget: (configuredDefault, pin) => {
        expect(pin).toEqual({ provider: 'openai', model: 'gpt-unicorn-9000' });
        return configuredDefault;
      },
    });
    const { userId, conversationId } = await seedConversation(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-unicorn-9000',
    });
    const out = await svc.compute({ conversationId, userId });
    expect(out.tokensBudget).toBe(10_000);
  });

  it('returns tokensUsed=0 for a conversation with no messages', async () => {
    const { svc, prisma } = build();
    const { userId, conversationId } = await seedConversation(prisma);
    const out = await svc.compute({ conversationId, userId });
    expect(out.tokensUsed).toBe(0);
  });

  it('honors the CONTEXT_TOKEN_BUDGET env override', async () => {
    process.env.CONTEXT_TOKEN_BUDGET = '5000';
    const { svc, prisma } = build({
      getEffectiveBudget: (configuredDefault) => configuredDefault,
    });
    const { userId, conversationId } = await seedConversation(prisma);
    const out = await svc.compute({ conversationId, userId });
    expect(out.tokensBudget).toBe(5000);
  });
});
