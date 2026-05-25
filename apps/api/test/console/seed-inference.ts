// Shared inference seeder for console repository / service tests.
import { randomUUID } from 'crypto';
import { InMemoryPrisma, InferenceKind } from '../fixtures/prisma-test-client';

export interface SeedInferenceOpts {
  id?: string;
  messageId?: string;
  kind?: InferenceKind;
  provider?: string;
  model?: string;
  status?: 'ok' | 'failed' | 'canceled' | 'streaming';
  promptCost?: number | null;
  completionCost?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  conversationId?: string;
  sampleWorkspaceId?: string | null;
  replayOfInferenceId?: string | null;
  inputPreview?: string | null;
  outputPreview?: string | null;
  errorCode?: string | null;
  traceId?: string | null;
  startedAt?: Date;
  endedAt?: Date | null;
  updatedAt?: Date;
}

export function seedInference(prisma: InMemoryPrisma, userId: string, o: SeedInferenceOpts = {}): string {
  const id = o.id ?? randomUUID();
  const startedAt = o.startedAt ?? new Date();
  prisma.inferences.push({
    id,
    messageId: o.messageId ?? randomUUID(),
    conversationId: o.conversationId ?? randomUUID(),
    userId,
    provider: o.provider ?? 'openai',
    model: o.model ?? 'gpt-4o',
    status: o.status ?? 'ok',
    kind: o.kind ?? 'chat',
    latencyMs: o.latencyMs ?? 120,
    promptTokens: o.promptTokens ?? 10,
    completionTokens: o.completionTokens ?? 20,
    promptCostUsdMicros: o.promptCost === undefined ? 1000 : o.promptCost,
    completionCostUsdMicros: o.completionCost === undefined ? 2000 : o.completionCost,
    startedAt,
    endedAt: o.endedAt ?? null,
    inputPreview: o.inputPreview ?? null,
    outputPreview: o.outputPreview ?? null,
    traceId: o.traceId ?? null,
    spanId: null,
    errorCode: o.errorCode ?? null,
    classifierForMessageId: null,
    replayOfInferenceId: o.replayOfInferenceId ?? null,
    sampleWorkspaceId: o.sampleWorkspaceId ?? null,
    updatedAt: o.updatedAt ?? startedAt,
  });
  return id;
}

export function seedConversation(prisma: InMemoryPrisma, userId: string, id: string, title: string): void {
  prisma.conversations.push({ id, userId, title, createdAt: new Date(), lastMessageAt: null });
}
