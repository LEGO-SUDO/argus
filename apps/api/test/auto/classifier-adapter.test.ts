import { randomUUID } from 'crypto';
import { ClassifierAdapter } from '../../src/auto/classifier-adapter';
import { FakeClock } from '../../src/common/clock';
import type { PrismaService } from '../../src/common/prisma.service';
import type { SdkChat, SdkChatRequest } from '../../src/common/sdk';
import { createInMemoryPrisma } from '../fixtures/prisma-test-client';
import type { ChatStreamChunk, ProviderMeta } from '@argus/sdk';

function streamYielding(tokens: string[], meta: ProviderMeta | null): SdkChat {
  return {
    // eslint-disable-next-line require-yield
    async *stream(): AsyncIterable<ChatStreamChunk> {
      for (const t of tokens) yield { type: 'token', content: t };
      if (meta) yield { type: 'done', providerMeta: meta };
    },
  };
}

function throwingStream(beforeThrow: string[]): SdkChat {
  return {
    async *stream(): AsyncIterable<ChatStreamChunk> {
      for (const t of beforeThrow) yield { type: 'token', content: t };
      throw new Error('provider blew up mid-stream');
    },
  };
}

const ctx = () => ({
  userId: randomUUID(),
  conversationId: randomUUID(),
  userMessageId: randomUUID(),
  content: 'why does my function throw',
});

describe('ClassifierAdapter', () => {
  it('persists exactly one kind=classifier row linked to the user message, returns the category', async () => {
    const prisma = createInMemoryPrisma();
    const captured: SdkChatRequest[] = [];
    const sdk: SdkChat = {
      stream(req: SdkChatRequest) {
        captured.push(req);
        return streamYielding(['cod', 'ing'], {
          provider: 'openai',
          model: 'gpt-4o-mini',
          promptTokens: 12,
          completionTokens: 1,
        }).stream(req);
      },
    };
    const adapter = new ClassifierAdapter(
      { db: prisma } as unknown as PrismaService,
      sdk,
      new FakeClock(0),
    );
    const input = ctx();

    const result = await adapter.classify(input);

    expect(result.category).toBe('coding');
    expect(prisma.inferences).toHaveLength(1);
    const row = prisma.inferences[0]!;
    expect(row.kind).toBe('classifier');
    expect(row.classifierForMessageId).toBe(input.userMessageId);
    expect(row.provider).toBe('openai');
    expect(row.model).toBe('gpt-4o-mini');
    expect(row.status).toBe('ok');
    expect(result.inferenceId).toBe(row.id);

    // Pinned to openai/gpt-4o-mini (the router honors a pin, not the ignored
    // provider/model hint), and sent a classification prompt.
    expect(captured).toHaveLength(1);
    expect(captured[0]!.pin).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    const systemMsg = captured[0]!.messages.find((m) => m.role === 'system');
    expect(systemMsg?.content.toLowerCase()).toContain('coding');
  });

  it('rejects on a chat.stream failure without persisting any row', async () => {
    const prisma = createInMemoryPrisma();
    const adapter = new ClassifierAdapter(
      { db: prisma } as unknown as PrismaService,
      throwingStream(['co']),
      new FakeClock(0),
    );
    await expect(adapter.classify(ctx())).rejects.toThrow(/blew up/);
    expect(prisma.inferences).toHaveLength(0);
  });

  it('defaults unrecognized output to general and still persists one classifier row', async () => {
    const prisma = createInMemoryPrisma();
    const adapter = new ClassifierAdapter(
      { db: prisma } as unknown as PrismaService,
      streamYielding(['banana'], { provider: 'openai', model: 'gpt-4o-mini' }),
      new FakeClock(0),
    );
    const input = ctx();
    const result = await adapter.classify(input);
    expect(result.category).toBe('general');
    expect(prisma.inferences).toHaveLength(1);
    expect(prisma.inferences[0]!.kind).toBe('classifier');
    expect(prisma.inferences[0]!.classifierForMessageId).toBe(input.userMessageId);
  });
});
