// ConversationsController.
//
// Pre-backbone coverage: omittedCount wiring on `GET /:id/messages`.
//
// chat-context-and-ux-polish backbone (LLD Tasks 76-89):
//   - PATCH accepts the expanded pin schema; validates non-null pins against
//     the live catalog; rejects unknown pairs with 400/invalid_pin.
//   - GET /:id/messages calls the meter inside try/catch; the response root
//     carries tokensUsed/tokensBudget on success and omits both on throw.
//   - GET /:id/messages runs the fallback resolver: persisted pin missing
//     from the live catalog → response carries pinFallback + previouslyPinned
//     and the conversation DTO ships null pins; row is NOT mutated.
import { ConversationsController } from '../../src/conversations/conversations.controller';
import { ConversationsRepository } from '../../src/conversations/conversations.repository';
import { MessagesRepository } from '../../src/conversations/messages.repository';
import { PrismaService } from '../../src/common/prisma.service';
import { ContextMeterService } from '../../src/chat/context-meter.service';
import type { SdkCatalogAccessor } from '../../src/common/sdk-catalog.provider';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { randomUUID } from 'crypto';
import type { AuthenticatedRequest } from '../../src/auth/session.guard';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfiguredProviderEntry } from '@argus/sdk';

interface BuildOptions {
  catalog?: Partial<SdkCatalogAccessor>;
  meterOverride?: ContextMeterService;
}

/**
 * chat-context-and-ux-polish (Codex review #2/#5) — pin validation + fallback
 * resolution now check the LIVE picker catalog (`listConfiguredProviders`),
 * NOT the cost.ts pricebook (`getCatalogEntry`). This helper builds a stub
 * that surfaces the given (provider, model) pairs as configured entries so
 * the tests exercise the same source the controller does.
 */
function liveCatalogWith(pairs: Array<[string, string]>): Partial<SdkCatalogAccessor> {
  const entries: ConfiguredProviderEntry[] = pairs.map(([provider, model]) => ({
    provider: provider as ConfiguredProviderEntry['provider'],
    model,
    promptPerMillion: 0,
    completionPerMillion: 0,
    contextWindow: 8192,
  }));
  return {
    listConfiguredProviders: () => entries,
    // getCatalogEntry intentionally diverges from the live list — it returns
    // an entry for ANY pair so that a test which relied on it (the old buggy
    // path) would PASS, proving the controller now uses the live list instead.
    getCatalogEntry: () => ({ promptPerMillion: 0, completionPerMillion: 0, contextWindow: 8192 }),
  };
}

interface BuildResult {
  controller: ConversationsController;
  prisma: InMemoryPrisma;
}

function build(prisma: InMemoryPrisma, opts: BuildOptions = {}): BuildResult {
  const ps = new PrismaService(prisma as never);
  const conversations = new ConversationsRepository(ps);
  const messages = new MessagesRepository(ps);
  const accessor: SdkCatalogAccessor = {
    listConfiguredProviders: opts.catalog?.listConfiguredProviders ?? (() => []),
    getCatalogEntry: opts.catalog?.getCatalogEntry ?? (() => null),
    getEffectiveBudget:
      opts.catalog?.getEffectiveBudget ?? ((configuredDefault) => configuredDefault),
  };
  const meter =
    opts.meterOverride ?? new ContextMeterService(ps, accessor);
  const controller = new ConversationsController(conversations, messages, meter, accessor);
  return { controller, prisma };
}

function req(userId: string): AuthenticatedRequest {
  return { user: { id: userId } } as AuthenticatedRequest;
}

const ORIGINAL_BUDGET = process.env.CONTEXT_TOKEN_BUDGET;

afterEach(() => {
  if (ORIGINAL_BUDGET === undefined) delete process.env.CONTEXT_TOKEN_BUDGET;
  else process.env.CONTEXT_TOKEN_BUDGET = ORIGINAL_BUDGET;
});

async function seedConv(
  prisma: InMemoryPrisma,
  pin: { pinnedProvider?: string | null; pinnedModel?: string | null } = {},
): Promise<{ userId: string; conversationId: string }> {
  const userId = randomUUID();
  const conversationId = randomUUID();
  prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
  prisma.conversations.push({
    id: conversationId,
    userId,
    title: 't',
    createdAt: new Date(),
    lastMessageAt: new Date(),
    pinnedProvider: pin.pinnedProvider ?? null,
    pinnedModel: pin.pinnedModel ?? null,
  });
  return { userId, conversationId };
}

describe('ConversationsController.listMessages — omittedCount (pre-backbone)', () => {
  it('omits the omittedCount field entirely when nothing is dropped (default budget, small conversation)', async () => {
    const { controller, prisma } = build(createInMemoryPrisma());
    const { userId, conversationId } = await seedConv(prisma);
    prisma.messages.push({
      id: randomUUID(),
      conversationId,
      userId,
      role: 'user',
      content: 'hi',
      status: 'complete',
      createdAt: new Date(),
      completedAt: new Date(),
    });
    const res = await controller.listMessages(req(userId), conversationId);
    expect(res.messages).toHaveLength(1);
    expect(res.omittedCount).toBeUndefined();
  });

  it('returns omittedCount > 0 when older messages exceed the token budget', async () => {
    process.env.CONTEXT_TOKEN_BUDGET = '100'; // tiny on purpose
    const { controller, prisma } = build(createInMemoryPrisma());
    const { userId, conversationId } = await seedConv(prisma);
    for (let i = 0; i < 5; i++) {
      prisma.messages.push({
        id: randomUUID(),
        conversationId,
        userId,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'a'.repeat(200),
        status: 'complete',
        createdAt: new Date(Date.now() - (5 - i) * 1000),
        completedAt: new Date(),
      });
    }
    const res = await controller.listMessages(req(userId), conversationId);
    expect(res.messages).toHaveLength(5);
    expect(res.omittedCount).toBe(3);
  });
});

// chat-context-and-ux-polish LLD Tasks 76-79 — PATCH pin handler.
describe('ConversationsController.update — pin PATCH (Tasks 76-79)', () => {
  it('accepts a valid pin pair (both in the live catalog) and persists', async () => {
    const { controller, prisma } = build(createInMemoryPrisma(), {
      catalog: liveCatalogWith([['anthropic', 'claude-haiku-4-5']]),
    });
    const { userId, conversationId } = await seedConv(prisma);
    const dto = await controller.update(req(userId), conversationId, {
      pinnedProvider: 'anthropic',
      pinnedModel: 'claude-haiku-4-5',
    });
    expect(dto.pinnedProvider).toBe('anthropic');
    expect(dto.pinnedModel).toBe('claude-haiku-4-5');
    const row = prisma.conversations.find((c) => c.id === conversationId);
    expect(row?.pinnedProvider).toBe('anthropic');
    expect(row?.pinnedModel).toBe('claude-haiku-4-5');
  });

  it('clears the pin when both fields are null', async () => {
    const { controller, prisma } = build(createInMemoryPrisma(), {
      catalog: liveCatalogWith([['mock', 'mock-1']]),
    });
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: 'mock',
      pinnedModel: 'mock-1',
    });
    const dto = await controller.update(req(userId), conversationId, {
      pinnedProvider: null,
      pinnedModel: null,
    });
    expect(dto.pinnedProvider).toBeNull();
    expect(dto.pinnedModel).toBeNull();
    const row = prisma.conversations.find((c) => c.id === conversationId);
    expect(row?.pinnedProvider).toBeNull();
    expect(row?.pinnedModel).toBeNull();
  });

  it('updates title + pin together in one round-trip', async () => {
    const { controller, prisma } = build(createInMemoryPrisma(), {
      catalog: liveCatalogWith([['openai', 'gpt-4o-mini']]),
    });
    const { userId, conversationId } = await seedConv(prisma);
    const dto = await controller.update(req(userId), conversationId, {
      title: 'renamed',
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    expect(dto.title).toBe('renamed');
    expect(dto.pinnedProvider).toBe('openai');
  });

  it('rejects a pin whose model is not in the live catalog with 400/invalid_pin', async () => {
    const { controller, prisma } = build(createInMemoryPrisma(), {
      // Only mock:mock-1 is in the live catalog.
      catalog: liveCatalogWith([['mock', 'mock-1']]),
    });
    const { userId, conversationId } = await seedConv(prisma);
    await expect(
      controller.update(req(userId), conversationId, {
        pinnedProvider: 'openai',
        pinnedModel: 'gpt-unicorn-9000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Persisted row UNCHANGED (no partial write on rejection).
    const row = prisma.conversations.find((c) => c.id === conversationId);
    expect(row?.pinnedProvider).toBeNull();
    expect(row?.pinnedModel).toBeNull();
  });

  // chat-context-and-ux-polish (Codex finding #5) — the load-bearing case. A
  // provider whose model IS in the cost.ts pricebook (getCatalogEntry returns
  // an entry) but is NOT in the live picker catalog (its API key is not
  // configured) MUST be rejected. The liveCatalogWith stub returns a non-null
  // getCatalogEntry for everything, so a controller that still validated
  // against the pricebook would WRONGLY accept this pin — this test fails on
  // the old behavior and passes on the new.
  it('rejects a pricebook-known but UNCONFIGURED provider (live catalog omits it) with 400/invalid_pin', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma, {
      // Live catalog has ONLY mock — e.g. MOCK_PROVIDER=true, no real keys.
      catalog: liveCatalogWith([['mock', 'mock-1']]),
    });
    const { userId, conversationId } = await seedConv(prisma);
    try {
      // openai:gpt-4o-mini is a real pricebook entry (getCatalogEntry !== null)
      // but absent from the live list.
      await controller.update(req(userId), conversationId, {
        pinnedProvider: 'openai',
        pinnedModel: 'gpt-4o-mini',
      });
      fail('expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const resp = (err as BadRequestException).getResponse() as {
        error?: { code?: string };
      };
      expect(resp.error?.code).toBe('invalid_pin');
    }
    // No partial write.
    const row = prisma.conversations.find((c) => c.id === conversationId);
    expect(row?.pinnedProvider).toBeNull();
  });

  it('rejects with invalid_pin when the provider is not configured (catalog has no entries)', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma, {
      catalog: liveCatalogWith([]),
    });
    const { userId, conversationId } = await seedConv(prisma);
    try {
      await controller.update(req(userId), conversationId, {
        pinnedProvider: 'anthropic',
        pinnedModel: 'claude-haiku-4-5',
      });
      fail('expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const resp = (err as BadRequestException).getResponse() as {
        error?: { code?: string };
      };
      expect(resp.error?.code).toBe('invalid_pin');
    }
  });

  // chat-context-and-ux-polish (Codex review — asymmetric/empty-mix negative
  // case). Schema-level coupling rejection surfaces `invalid_request`, NOT
  // `invalid_pin` — the request never reaches the catalog check.
  it('rejects an asymmetric pin (only provider) with 400/invalid_request before any catalog check', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma, {
      catalog: liveCatalogWith([['openai', 'gpt-4o-mini']]),
    });
    const { userId, conversationId } = await seedConv(prisma);
    try {
      await controller.update(req(userId), conversationId, {
        pinnedProvider: 'openai',
        // pinnedModel omitted → coupling violation.
      });
      fail('expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const resp = (err as BadRequestException).getResponse() as {
        error?: { code?: string };
      };
      expect(resp.error?.code).toBe('invalid_request');
    }
  });

  it('rejects a null/string-mix pin with 400/invalid_request (coupling violation)', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma, {
      catalog: liveCatalogWith([['openai', 'gpt-4o-mini']]),
    });
    const { userId, conversationId } = await seedConv(prisma);
    try {
      await controller.update(req(userId), conversationId, {
        pinnedProvider: 'openai',
        pinnedModel: null,
      });
      fail('expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const resp = (err as BadRequestException).getResponse() as {
        error?: { code?: string };
      };
      expect(resp.error?.code).toBe('invalid_request');
    }
  });

  it('still accepts a title-only PATCH', async () => {
    const { controller, prisma } = build(createInMemoryPrisma());
    const { userId, conversationId } = await seedConv(prisma);
    const dto = await controller.update(req(userId), conversationId, { title: 'renamed' });
    expect(dto.title).toBe('renamed');
  });

  it('returns 404 when the conversation does not belong to the caller', async () => {
    const { controller, prisma } = build(createInMemoryPrisma());
    await seedConv(prisma);
    const intruder = randomUUID();
    await expect(
      controller.update(req(intruder), randomUUID(), { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// chat-context-and-ux-polish LLD Tasks 80-85 — meter wiring on the messages
// list controller.
describe('ConversationsController.listMessages — meter (Tasks 80-85)', () => {
  it('surfaces tokensUsed + tokensBudget on the response for an unpinned conversation (defaults)', async () => {
    const { controller, prisma } = build(createInMemoryPrisma(), {
      catalog: { getEffectiveBudget: (configuredDefault) => configuredDefault },
    });
    const { userId, conversationId } = await seedConv(prisma);
    prisma.messages.push({
      id: randomUUID(),
      conversationId,
      userId,
      role: 'user',
      content: 'a'.repeat(400), // 100 tokens
      status: 'complete',
      createdAt: new Date(),
      completedAt: new Date(),
    });
    const res = await controller.listMessages(req(userId), conversationId);
    expect(res.tokensUsed).toBe(100);
    expect(res.tokensBudget).toBe(10_000);
  });

  it('caps tokensBudget at the pinned model window when smaller than default (Task 82)', async () => {
    const { controller, prisma } = build(createInMemoryPrisma(), {
      catalog: {
        getEffectiveBudget: (configuredDefault, pin) => {
          if (pin) return Math.min(configuredDefault, 8192);
          return configuredDefault;
        },
        // Pin is in catalog so the fallback resolver doesn't kick in.
        getCatalogEntry: (p, m) =>
          p === 'mock' && m === 'mock-1'
            ? { promptPerMillion: 0, completionPerMillion: 0, contextWindow: 8192 }
            : null,
      },
    });
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: 'mock',
      pinnedModel: 'mock-1',
    });
    const res = await controller.listMessages(req(userId), conversationId);
    expect(res.tokensBudget).toBe(8192);
  });

  it('omits both context fields when the meter throws (Task 84)', async () => {
    const prisma = createInMemoryPrisma();
    const ps = new PrismaService(prisma as never);
    const stubMeter = {
      compute: async () => {
        throw new Error('meter blew up');
      },
    } as unknown as ContextMeterService;
    const { controller } = build(prisma, { meterOverride: stubMeter });
    void ps; // referenced via build()
    const { userId, conversationId } = await seedConv(prisma);
    prisma.messages.push({
      id: randomUUID(),
      conversationId,
      userId,
      role: 'user',
      content: 'hi',
      status: 'complete',
      createdAt: new Date(),
      completedAt: new Date(),
    });
    const res = await controller.listMessages(req(userId), conversationId);
    // Messages still ship.
    expect(res.messages).toHaveLength(1);
    expect(res.tokensUsed).toBeUndefined();
    expect(res.tokensBudget).toBeUndefined();
  });
});

// chat-context-and-ux-polish LLD Task 86/89 — fallback resolver.
describe('ConversationsController.listMessages — pin fallback resolver (Tasks 86/89)', () => {
  it('persisted pin missing from the live catalog → response shows pinFallback true + previouslyPinned, conversation row UNCHANGED', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma, {
      // Empty live catalog: any persisted pin will look dropped.
      catalog: liveCatalogWith([]),
    });
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-unicorn-9000',
    });
    const res = await controller.listMessages(req(userId), conversationId);
    expect(res.pinFallback).toBe(true);
    expect(res.previouslyPinned).toEqual({
      provider: 'openai',
      model: 'gpt-unicorn-9000',
    });
    // The effective conversation DTO carries null pins (Task 86).
    expect(res.conversation?.pinnedProvider).toBeNull();
    expect(res.conversation?.pinnedModel).toBeNull();
    // Persisted columns NOT mutated.
    const row = prisma.conversations.find((c) => c.id === conversationId);
    expect(row?.pinnedProvider).toBe('openai');
    expect(row?.pinnedModel).toBe('gpt-unicorn-9000');
    // Subsequent read returns the same signal (idempotent — no state drift).
    const res2 = await controller.listMessages(req(userId), conversationId);
    expect(res2.pinFallback).toBe(true);
    expect(res2.previouslyPinned).toEqual({
      provider: 'openai',
      model: 'gpt-unicorn-9000',
    });
  });

  // chat-context-and-ux-polish (Codex finding #2/#5) — fallback resolution
  // uses the LIVE catalog too. A persisted pin whose provider/model IS in the
  // cost.ts pricebook but is NOT in the live picker catalog (key not
  // configured) MUST fall back. The liveCatalogWith stub returns a non-null
  // getCatalogEntry for everything, so a resolver still checking the pricebook
  // would WRONGLY treat this pin as live (no fallback) — this fails on the old
  // behavior and passes on the new.
  it('persisted pin pricebook-known but UNCONFIGURED (absent from live catalog) → falls back', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma, {
      // Live catalog has ONLY mock; openai is not configured.
      catalog: liveCatalogWith([['mock', 'mock-1']]),
    });
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    const res = await controller.listMessages(req(userId), conversationId);
    expect(res.pinFallback).toBe(true);
    expect(res.previouslyPinned).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    // Row UNCHANGED.
    const row = prisma.conversations.find((c) => c.id === conversationId);
    expect(row?.pinnedProvider).toBe('openai');
  });

  it('persisted pin in the live catalog → no fallback flag, no previouslyPinned', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma, {
      catalog: liveCatalogWith([['openai', 'gpt-4o-mini']]),
    });
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    const res = await controller.listMessages(req(userId), conversationId);
    expect(res.pinFallback).toBeUndefined();
    expect(res.previouslyPinned).toBeUndefined();
    // Effective DTO keeps the live pin.
    expect(res.conversation?.pinnedProvider).toBe('openai');
    expect(res.conversation?.pinnedModel).toBe('gpt-4o-mini');
  });

  it('unpinned conversation → no fallback signals (only set when there is a persisted pin to evaluate)', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma);
    const { userId, conversationId } = await seedConv(prisma);
    const res = await controller.listMessages(req(userId), conversationId);
    expect(res.pinFallback).toBeUndefined();
    expect(res.previouslyPinned).toBeUndefined();
    // Effective DTO carries null pins on an unpinned conversation.
    expect(res.conversation?.pinnedProvider).toBeNull();
    expect(res.conversation?.pinnedModel).toBeNull();
  });
});

// chat-context-and-ux-polish (HLD §Observability / Codex review) — a structured
// `conversation.pin.fallback` event must fire on the read-time downgrade
// transition (and only then) so the fallback is queryable in log search.
describe('ConversationsController.listMessages — pin-fallback observability event', () => {
  function spyWarn(controller: ConversationsController): jest.SpyInstance {
    const logger = (controller as unknown as { logger: { warn: (m: string) => void } }).logger;
    return jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  }

  it('emits a conversation.pin.fallback warning when a persisted pin falls back', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma, { catalog: liveCatalogWith([]) });
    const warn = spyWarn(controller);
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-unicorn-9000',
    });
    await controller.listMessages(req(userId), conversationId);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain('conversation.pin.fallback');
    expect(msg).toContain(`conversationId=${conversationId}`);
    expect(msg).toContain('previousProvider=openai');
    expect(msg).toContain('previousModel=gpt-unicorn-9000');
    warn.mockRestore();
  });

  it('does NOT emit the event when the persisted pin is still live', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma, {
      catalog: liveCatalogWith([['openai', 'gpt-4o-mini']]),
    });
    const warn = spyWarn(controller);
    const { userId, conversationId } = await seedConv(prisma, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    await controller.listMessages(req(userId), conversationId);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does NOT emit the event for an unpinned conversation', async () => {
    const prisma = createInMemoryPrisma();
    const { controller } = build(prisma);
    const warn = spyWarn(controller);
    const { userId, conversationId } = await seedConv(prisma);
    await controller.listMessages(req(userId), conversationId);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
