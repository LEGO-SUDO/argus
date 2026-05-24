import { randomUUID } from 'crypto';
import { SamplesService, InvalidSampleCountError } from '../../src/console/samples.service';
import { ChatService } from '../../src/chat/chat.service';
import { SeqCounterRegistry } from '../../src/chat/seq-counter';
import { OrchestratorRegistry } from '../../src/orchestrator/registry';
import type { PrismaService } from '../../src/common/prisma.service';
import type { ApiConfig } from '../../src/common/config';
import type { SdkChat } from '../../src/common/sdk';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import type { ChatStreamChunk } from '@argus/sdk';

function recordingSdk(calls: string[]): SdkChat {
  return {
    stream(req) {
      calls.push(req.provider ?? 'unknown');
      return (async function* (): AsyncIterable<ChatStreamChunk> {
        yield { type: 'token', content: 'sample' };
        yield { type: 'done', providerMeta: { provider: 'mock', model: 'mock-1' } };
      })();
    },
  };
}

interface Built {
  service: SamplesService;
  prisma: InMemoryPrisma;
  userId: string;
  sdkCalls: string[];
}

function build(samplesDefaultCount = 8): Built {
  const prisma = createInMemoryPrisma();
  const ps = { db: prisma } as unknown as PrismaService;
  const chat = new ChatService(ps);
  const sdkCalls: string[] = [];
  const config = { samplesDefaultCount } as ApiConfig;
  const service = new SamplesService(ps, chat, new SeqCounterRegistry(), new OrchestratorRegistry(), recordingSdk(sdkCalls), config);
  const userId = randomUUID();
  prisma.users.push({ id: userId, email: 'u@t', passwordHash: 'x', createdAt: new Date() });
  prisma.sessions.push({ id: randomUUID(), userId, tokenHash: 't', expiresAt: new Date(Date.now() + 1e9), createdAt: new Date(), currentSampleWorkspaceId: null });
  return { service, prisma, userId, sdkCalls };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 15));

describe('SamplesService.generate', () => {
  it('creates one workspace and points the user session at it (replacing any prior pointer)', async () => {
    const b = build();
    b.prisma.sessions[0]!.currentSampleWorkspaceId = randomUUID(); // prior pointer
    const res = await b.service.generate({ userId: b.userId, count: 2 });
    await flush();
    expect(b.prisma.sampleWorkspaces).toHaveLength(1);
    expect(b.prisma.sampleWorkspaces[0]!.id).toBe(res.workspaceId);
    expect(b.prisma.sessions[0]!.currentSampleWorkspaceId).toBe(res.workspaceId);
  });

  it('kicks off N sample-tagged runs against mock', async () => {
    const b = build();
    const res = await b.service.generate({ userId: b.userId, count: 4 });
    await flush();
    const sampleRows = b.prisma.inferences.filter((i) => i.kind === 'sample');
    expect(sampleRows).toHaveLength(4);
    expect(sampleRows.every((r) => r.sampleWorkspaceId === res.workspaceId)).toBe(true);
    expect(res.count).toBe(4);
    // Every run targeted mock — sample turns never hit real providers.
    expect(b.sdkCalls).toHaveLength(4);
    expect(b.sdkCalls.every((p) => p === 'mock')).toBe(true);
  });

  it('defaults to the configured count when none is supplied', async () => {
    const b = build(3);
    const res = await b.service.generate({ userId: b.userId });
    await flush();
    expect(res.count).toBe(3);
    expect(b.prisma.inferences.filter((i) => i.kind === 'sample')).toHaveLength(3);
  });

  it('rejects a non-positive count and commits nothing', async () => {
    const b = build();
    await expect(b.service.generate({ userId: b.userId, count: 0 })).rejects.toBeInstanceOf(InvalidSampleCountError);
    await expect(b.service.generate({ userId: b.userId, count: -3 })).rejects.toBeInstanceOf(InvalidSampleCountError);
    expect(b.prisma.sampleWorkspaces).toHaveLength(0);
    expect(b.prisma.inferences).toHaveLength(0);
  });
});
