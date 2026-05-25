import { randomUUID } from 'crypto';
import {
  ReplayService,
  IneligibleReplayError,
  ReplaySourceNotFoundError,
} from '../../src/replay/replay.service';
import { ChatService } from '../../src/chat/chat.service';
import { SeqCounterRegistry } from '../../src/chat/seq-counter';
import { OrchestratorRegistry } from '../../src/orchestrator/registry';
import type { PrismaService } from '../../src/common/prisma.service';
import type { SdkChat } from '../../src/common/sdk';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { seedInference } from '../console/seed-inference';
import type { ChatStreamChunk } from '@argus/sdk';

function completingSdk(captured?: { messages?: unknown; pin?: unknown }): SdkChat {
  return {
    stream(req) {
      if (captured) {
        captured.messages = req.messages;
        captured.pin = req.pin;
      }
      // The router commits the pinned provider/model (R1) — mirror that here so
      // the stub's `done` chunk carries the chosen pair, not a generic default.
      return (async function* (): AsyncIterable<ChatStreamChunk> {
        yield { type: 'token', content: 'replayed' };
        yield {
          type: 'done',
          providerMeta: { provider: req.pin?.provider ?? 'mock', model: req.pin?.model ?? 'mock-1' },
        };
      })();
    },
  };
}

interface Built {
  service: ReplayService;
  prisma: InMemoryPrisma;
  registry: OrchestratorRegistry;
  userId: string;
  conversationId: string;
}

function build(sdk?: SdkChat): Built {
  const prisma = createInMemoryPrisma();
  const ps = { db: prisma } as unknown as PrismaService;
  const chat = new ChatService(ps);
  const registry = new OrchestratorRegistry();
  const service = new ReplayService(ps, chat, new SeqCounterRegistry(), registry, sdk ?? completingSdk());
  const userId = randomUUID();
  const conversationId = randomUUID();
  prisma.users.push({ id: userId, email: 'u@t', passwordHash: 'x', createdAt: new Date() });
  prisma.conversations.push({ id: conversationId, userId, title: 'c', createdAt: new Date(), lastMessageAt: null });
  return { service, prisma, registry, userId, conversationId };
}

// Seed a prior chat turn (user msg + assistant msg) and its source inference.
function seedSourceTurn(b: Built, opts: { status?: 'ok' | 'failed' | 'canceled' | 'streaming'; sampleWorkspaceId?: string | null; kind?: 'chat' | 'sample' } = {}): string {
  const assistantMsgId = randomUUID();
  const t = Date.now();
  b.prisma.messages.push({ id: randomUUID(), conversationId: b.conversationId, userId: b.userId, role: 'user', content: 'original question', status: 'complete', createdAt: new Date(t - 1000), completedAt: new Date(t - 1000) });
  b.prisma.messages.push({ id: assistantMsgId, conversationId: b.conversationId, userId: b.userId, role: 'assistant', content: 'original answer', status: 'complete', createdAt: new Date(t), completedAt: new Date(t) });
  return seedInference(b.prisma, b.userId, {
    messageId: assistantMsgId,
    conversationId: b.conversationId,
    kind: opts.kind ?? 'chat',
    status: opts.status ?? 'ok',
    sampleWorkspaceId: opts.sampleWorkspaceId ?? null,
    inputPreview: 'original question',
    outputPreview: 'original answer',
  });
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

describe('ReplayService.run', () => {
  it('rejects an ineligible (streaming) source and writes no new inference row', async () => {
    const b = build();
    const sourceId = seedSourceTurn(b, { status: 'streaming' });
    const before = b.prisma.inferences.length;
    await expect(b.service.run({ userId: b.userId, sourceInferenceId: sourceId, provider: 'openai', model: 'gpt-4o' })).rejects.toBeInstanceOf(IneligibleReplayError);
    expect(b.prisma.inferences.length).toBe(before);
  });

  it('rejects a cross-user source (defense in depth)', async () => {
    const b = build();
    const otherUserSource = seedInference(b.prisma, randomUUID(), { status: 'ok' });
    await expect(b.service.run({ userId: b.userId, sourceInferenceId: otherUserSource, provider: 'openai', model: 'gpt-4o' })).rejects.toBeInstanceOf(ReplaySourceNotFoundError);
  });

  it('reconstructs the input and passes it to the SDK stream', async () => {
    const captured: { messages?: unknown } = {};
    const b = build(completingSdk(captured));
    const sourceId = seedSourceTurn(b);
    await b.service.run({ userId: b.userId, sourceInferenceId: sourceId, provider: 'anthropic', model: 'claude-haiku-4-5' });
    await flush();
    const msgs = captured.messages as Array<{ role: string; content: string }>;
    expect(msgs.some((m) => m.role === 'user' && m.content === 'original question')).toBe(true);
  });

  // REVIEW-BRIEF Finding 5 (R1): the chosen target provider/model must reach
  // the router as a `pin` — passing them as ignored hint fields silently
  // re-ran every replay against the default router head.
  it('threads the chosen provider/model to the router as a pin', async () => {
    const captured: { pin?: unknown } = {};
    const b = build(completingSdk(captured));
    const sourceId = seedSourceTurn(b);
    await b.service.run({ userId: b.userId, sourceInferenceId: sourceId, provider: 'anthropic', model: 'claude-haiku-4-5' });
    await flush();
    expect(captured.pin).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' });
  });

  it('persists a kind=replay row with the self-FK and returns the new ids', async () => {
    const b = build();
    const sourceId = seedSourceTurn(b);
    const res = await b.service.run({ userId: b.userId, sourceInferenceId: sourceId, provider: 'anthropic', model: 'claude-haiku-4-5' });
    await flush();
    const replayRow = b.prisma.inferences.find((i) => i.kind === 'replay')!;
    expect(replayRow.replayOfInferenceId).toBe(sourceId);
    expect(replayRow.messageId).toBe(res.messageId);
    expect(res.inferenceId).toBe(replayRow.id);
    expect(res.diff).toBeNull();
  });

  it('inherits sample_workspace_id from a sample source', async () => {
    const b = build();
    const ws = randomUUID();
    const sourceId = seedSourceTurn(b, { kind: 'sample', sampleWorkspaceId: ws });
    await b.service.run({ userId: b.userId, sourceInferenceId: sourceId, provider: 'openai', model: 'gpt-4o' });
    await flush();
    const replayRow = b.prisma.inferences.find((i) => i.kind === 'replay')!;
    expect(replayRow.sampleWorkspaceId).toBe(ws);
  });

  it('registers a replay handle while in flight and deregisters on terminal', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const heldSdk: SdkChat = {
      stream(req) {
        return (async function* (): AsyncIterable<ChatStreamChunk> {
          yield { type: 'token', content: 'x' };
          await gate;
          yield {
            type: 'done',
            providerMeta: { provider: req.pin?.provider ?? 'mock', model: req.pin?.model ?? 'mock-1' },
          };
        })();
      },
    };
    const b = build(heldSdk);
    const sourceId = seedSourceTurn(b);
    const res = await b.service.run({ userId: b.userId, sourceInferenceId: sourceId, provider: 'openai', model: 'gpt-4o' });

    const inflight = b.registry.list(b.userId);
    expect(inflight).toHaveLength(1);
    expect(inflight[0]!.kind).toBe('replay');
    expect(inflight[0]!.messageId).toBe(res.messageId);

    release();
    await flush();
    expect(b.registry.list(b.userId)).toEqual([]);
  });
});
