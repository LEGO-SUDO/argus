import { randomUUID } from 'crypto';
import { AutoRouterService } from '../../src/auto/auto-router.service';
import { ClassifierAdapter } from '../../src/auto/classifier-adapter';
import { FakeClock } from '../../src/common/clock';
import type { ApiConfig } from '../../src/common/config';
import type { PrismaService } from '../../src/common/prisma.service';
import type { SdkChat } from '../../src/common/sdk';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import * as sentry from '../../src/observability/sentry';
import type { ChatStreamChunk } from '@argus/sdk';

function constStream(word: string): SdkChat {
  return {
    async *stream(): AsyncIterable<ChatStreamChunk> {
      yield { type: 'token', content: word };
      yield { type: 'done', providerMeta: { provider: 'openai', model: 'gpt-4o-mini' } };
    },
  };
}

function throwingSdk(): SdkChat {
  return {
    // eslint-disable-next-line require-yield
    async *stream(): AsyncIterable<ChatStreamChunk> {
      throw new Error('classifier provider down');
    },
  };
}

function realAdapter(prisma: InMemoryPrisma, sdk: SdkChat): ClassifierAdapter {
  return new ClassifierAdapter({ db: prisma } as unknown as PrismaService, sdk, new FakeClock(0));
}

const cfg = (openAiKeyConfigured: boolean): ApiConfig =>
  ({ openAiKeyConfigured }) as ApiConfig;

const turn = () => ({
  userId: randomUUID(),
  conversationId: randomUUID(),
  userMessageId: randomUUID(),
  content: 'write a regex for me', // heuristic → coding
});

describe('AutoRouterService', () => {
  it('classifier dispatch path: invokes adapter, persists one row, returns category provider + id', async () => {
    const prisma = createInMemoryPrisma();
    const router = new AutoRouterService(cfg(true), realAdapter(prisma, constStream('research')));
    const decision = await router.route(turn());
    expect(prisma.inferences).toHaveLength(1);
    expect(prisma.inferences[0]!.kind).toBe('classifier');
    expect(decision.provider).toBe('gemini'); // research → gemini
    expect(decision.classifierInferenceId).toBe(prisma.inferences[0]!.id);
  });

  it('keyless heuristic path: no classifier row, null id, provider from heuristic', async () => {
    const prisma = createInMemoryPrisma();
    const router = new AutoRouterService(cfg(false), realAdapter(prisma, constStream('research')));
    const decision = await router.route(turn());
    expect(prisma.inferences).toHaveLength(0);
    expect(decision.classifierInferenceId).toBeNull();
    expect(decision.provider).toBe('anthropic'); // "regex" → coding → anthropic
  });

  it('classifier-throws falls back to heuristic, persists zero rows, captures the error', async () => {
    const prisma = createInMemoryPrisma();
    const spy = jest.spyOn(sentry, 'captureApiError').mockImplementation(() => undefined);
    const router = new AutoRouterService(cfg(true), realAdapter(prisma, throwingSdk()));
    const decision = await router.route(turn());
    expect(prisma.inferences).toHaveLength(0);
    expect(decision.classifierInferenceId).toBeNull();
    expect(decision.provider).toBe('anthropic'); // heuristic fallback
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ feature: 'auto', layer: 'service' }));
    spy.mockRestore();
  });
});
