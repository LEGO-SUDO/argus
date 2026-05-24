// SamplesService — the Generate-Samples orchestrator.
//
// Mints a sample_workspaces row, points the user's session at it, and kicks off
// N fire-and-forget orchestrator runs against Mock (sample turns never hit real
// providers), each tagged kind='sample' + the new workspace id. The count is
// validated up front so a bad request commits nothing.
import { Inject, Injectable } from '@nestjs/common';
import { GenerateSamplesRequestSchema, type SampleGenerateResponse } from '@argus/contracts';
import { PrismaService } from '../common/prisma.service';
import { ChatService } from '../chat/chat.service';
import { SeqCounterRegistry } from '../chat/seq-counter';
import { StreamOrchestrator } from '../chat/stream-orchestrator';
import { OrchestratorRegistry } from '../orchestrator/registry';
import type { OrchestratorHandle } from '../orchestrator/handle';
import { SDK_CHAT_TOKEN, type SdkChat } from '../common/sdk';
import { API_CONFIG_TOKEN, type ApiConfig } from '../common/config';
import { captureApiError } from '../observability/sentry';
import { SAMPLE_PROMPTS } from './sample-prompts';

const SAMPLE_PROVIDER = 'mock';
const SAMPLE_MODEL = 'mock-1';

export class InvalidSampleCountError extends Error {
  constructor() {
    super('count must be a positive integer');
    this.name = 'InvalidSampleCountError';
  }
}

export interface GenerateSamplesInput {
  userId: string;
  count?: number;
}

@Injectable()
export class SamplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly seqRegistry: SeqCounterRegistry,
    private readonly registry: OrchestratorRegistry,
    @Inject(SDK_CHAT_TOKEN) private readonly sdk: SdkChat,
    @Inject(API_CONFIG_TOKEN) private readonly config: ApiConfig,
  ) {}

  async generate(input: GenerateSamplesInput): Promise<SampleGenerateResponse> {
    // Validate BEFORE any write — a bad count commits nothing.
    const parsed = GenerateSamplesRequestSchema.safeParse({ count: input.count });
    if (!parsed.success) throw new InvalidSampleCountError();
    const n = parsed.data.count ?? this.config.samplesDefaultCount;

    // Mint workspace + point the session, atomically.
    const { workspaceId, conversationId } = await this.prisma.db.$transaction(async (tx) => {
      const ws = await tx.sampleWorkspace.create({ data: { userId: input.userId } });
      const conv = await tx.conversation.create({ data: { userId: input.userId, title: 'Sample workspace' } });
      await tx.session.updateMany({
        where: { userId: input.userId },
        data: { currentSampleWorkspaceId: ws.id },
      });
      return { workspaceId: ws.id, conversationId: conv.id };
    });

    // Kick off N fire-and-forget mock runs.
    for (let i = 0; i < n; i++) {
      const prompt = SAMPLE_PROMPTS[i % SAMPLE_PROMPTS.length]!;
      await this.kickOff(input.userId, conversationId, workspaceId, prompt.content);
    }

    return { workspaceId, count: n };
  }

  private async kickOff(userId: string, conversationId: string, workspaceId: string, content: string): Promise<void> {
    const { assistantMessageId } = await this.chat.startTurn({
      userId,
      conversationId,
      userMessageContent: content,
      kind: 'sample',
      sampleWorkspaceId: workspaceId,
    });

    const abort = new AbortController();
    const sdkStream = this.sdk.stream({
      messages: [{ role: 'user', content }],
      conversationId,
      turnIndex: 0,
      userId,
      messageId: assistantMessageId,
      signal: abort.signal,
      provider: SAMPLE_PROVIDER,
      model: SAMPLE_MODEL,
    });
    const orchestrator = new StreamOrchestrator(this.chat, this.seqRegistry, {
      messageId: assistantMessageId,
      conversationId,
      provider: SAMPLE_PROVIDER,
      model: SAMPLE_MODEL,
      sdkStream,
      abort,
      emit: () => undefined,
    });
    const handle: OrchestratorHandle = { messageId: assistantMessageId, kind: 'sample', cancel: () => orchestrator.cancel() };
    this.registry.register(userId, handle);
    void orchestrator
      .runStream()
      .catch((err) =>
        captureApiError({ err, feature: 'console', layer: 'service', extra: { stage: 'sample-run', messageId: assistantMessageId } }),
      )
      .finally(() => this.registry.deregister(userId, assistantMessageId));
  }
}
