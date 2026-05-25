// ClassifierAdapter — wraps a one-shot classification call to the SDK chat
// surface (provider=openai, model=gpt-4o-mini) and persists its own
// `kind='classifier'` inference row.
//
// The adapter OWNS the row write — `chat.stream` is used purely as a model-call
// primitive (no projection double-count). It builds a classification prompt,
// accumulates the streamed output, parses it to a category (defaulting to
// `general` on unrecognized output), and links the row to the triggering user
// message via `classifierForMessageId`. On a thrown stream it propagates the
// error WITHOUT persisting (the router catches and falls back to the heuristic).
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { Clock } from '../common/clock';
import { SDK_CHAT_TOKEN, type SdkChat } from '../common/sdk';
import type { Category } from './keyword-heuristic';

const CLASSIFIER_PROVIDER = 'openai';
const CLASSIFIER_MODEL = 'gpt-4o-mini';

const CLASSIFY_SYSTEM_PROMPT =
  'You are a routing classifier. Read the user message and respond with EXACTLY ONE ' +
  'word — either `coding`, `research`, or `general` — naming the best category. ' +
  'Output only that single word, nothing else.';

export interface ClassifyInput {
  userId: string;
  conversationId: string;
  /** The user message that triggered classification (the FK target). */
  userMessageId: string;
  /** The user-authored content to classify. */
  content: string;
  turnIndex?: number;
}

export interface ClassifyResult {
  category: Category;
  /** Id of the persisted `kind='classifier'` inference row. */
  inferenceId: string;
}

function parseCategory(raw: string): Category {
  const t = raw.trim().toLowerCase();
  if (t.startsWith('coding')) return 'coding';
  if (t.startsWith('research')) return 'research';
  if (t.startsWith('general')) return 'general';
  if (t.includes('coding')) return 'coding';
  if (t.includes('research')) return 'research';
  return 'general';
}

@Injectable()
export class ClassifierAdapter {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SDK_CHAT_TOKEN) private readonly sdk: SdkChat,
    private readonly clock: Clock,
  ) {}

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    const classifierMessageId = randomUUID();
    const startedAt = this.clock.now();

    // Drive the SDK stream. A throw here propagates WITHOUT any DB write.
    let accumulated = '';
    let metaProvider = CLASSIFIER_PROVIDER;
    let metaModel = CLASSIFIER_MODEL;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;

    const stream = this.sdk.stream({
      messages: [
        { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
        { role: 'user', content: input.content },
      ],
      conversationId: input.conversationId,
      turnIndex: input.turnIndex ?? 0,
      userId: input.userId,
      messageId: classifierMessageId,
      // Pin (not the ignored provider/model hint) so the classify call actually
      // runs on the classifier model — same fix as REVIEW-BRIEF Finding 5 R1 for
      // Replay. Safe here: AutoRouterService only invokes the classifier when
      // openAiKeyConfigured is true (CLASSIFIER_PROVIDER='openai'), and a pinned
      // failure throws → route() degrades to the keyword heuristic (never
      // provider failover, by design).
      pin: { provider: CLASSIFIER_PROVIDER, model: CLASSIFIER_MODEL },
    });

    for await (const chunk of stream) {
      if (chunk.type === 'token') {
        accumulated += chunk.content;
      } else if (chunk.type === 'done') {
        metaProvider = chunk.providerMeta.provider || CLASSIFIER_PROVIDER;
        metaModel = chunk.providerMeta.model || CLASSIFIER_MODEL;
        promptTokens = chunk.providerMeta.promptTokens ?? null;
        completionTokens = chunk.providerMeta.completionTokens ?? null;
      }
    }

    const category = parseCategory(accumulated);
    const endedAt = this.clock.now();

    const row = await this.prisma.db.inference.create({
      data: {
        messageId: classifierMessageId,
        conversationId: input.conversationId,
        userId: input.userId,
        provider: metaProvider,
        model: metaModel,
        status: 'ok',
        kind: 'classifier',
        classifierForMessageId: input.userMessageId,
        promptTokens,
        completionTokens,
        startedAt,
        endedAt,
        updatedAt: endedAt,
      },
    });

    return { category, inferenceId: row.id };
  }
}
