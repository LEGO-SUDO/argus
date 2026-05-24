// ContextMeterService — computes (tokensUsed, tokensBudget) for a conversation.
//
// chat-context-and-ux-polish LLD Tasks 54/55. Consumed by:
//   - StreamOrchestrator on the `complete` terminal (Task 57) to populate
//     the WS `end` frame's context fields.
//   - ConversationsController.listMessages (Task 81) to populate the
//     response root's `tokensUsed` + `tokensBudget`.
//
// Computation:
//   - tokensUsed: sum of `estimateTokens(content)` across all messages in the
//     conversation, filtered by userId (per-row authz match the messages
//     repository pattern).
//   - tokensBudget: `getEffectiveBudget(defaultContextBudget(), pin)`. With
//     no pin → configured default. Pinned + known catalog entry → min of
//     default and pinned model's context window. Pinned + unknown entry →
//     configured default (SDK accessor's documented tolerance).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SDK_CATALOG, type SdkCatalogAccessor } from '../common/sdk-catalog.provider';
import { defaultContextBudget, estimateTokens } from '../common/token-heuristic';

export interface ContextMeterReadout {
  tokensUsed: number;
  tokensBudget: number;
}

export interface ContextMeterInput {
  conversationId: string;
  userId: string;
  /**
   * Optional assistant message id for the in-flight turn. When present it's
   * stamped onto the `chat.context.truncated` event so the truncation can be
   * correlated to a specific turn in log search (HLD §Observability).
   */
  messageId?: string;
}

@Injectable()
export class ContextMeterService {
  private readonly logger = new Logger(ContextMeterService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SDK_CATALOG) private readonly catalog: SdkCatalogAccessor,
  ) {}

  /**
   * Compute the (tokensUsed, tokensBudget) pair for a conversation.
   *
   * The conversation MUST exist and belong to the caller — we filter by
   * userId on every row to match the per-row authorization discipline used
   * elsewhere in the api. Returns zero usage for a conversation with no
   * messages rather than throwing (the controller might invoke us on a
   * brand-new conversation).
   */
  async compute(input: ContextMeterInput): Promise<ContextMeterReadout> {
    const [messages, conv] = await Promise.all([
      this.prisma.db.message.findMany({
        where: { conversationId: input.conversationId, userId: input.userId },
        // Read content (for the token estimate) in chronological order so the
        // truncation accounting below can drop oldest-first the same way the
        // SDK's context builder (and computeOmittedCount) does.
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.conversation.findFirst({
        where: { id: input.conversationId, userId: input.userId },
      }),
    ]);

    const rows = messages as Array<{ content: string }>;
    let tokensUsed = 0;
    for (const m of rows) {
      tokensUsed += estimateTokens(m.content);
    }

    const defaultBudget = defaultContextBudget();
    // Pin descriptor is built only when both columns are present-and-strings.
    // The DB-level columns are nullable; the application-level coupling rule
    // ensures they move together but we still null-guard here for safety.
    const pinnedProvider = (conv as { pinnedProvider?: string | null } | null)?.pinnedProvider ?? null;
    const pinnedModel = (conv as { pinnedModel?: string | null } | null)?.pinnedModel ?? null;
    const pin =
      pinnedProvider && pinnedModel
        ? { provider: pinnedProvider, model: pinnedModel }
        : undefined;
    const tokensBudget = this.catalog.getEffectiveBudget(defaultBudget, pin);

    // HLD §Observability — structured event when history is truncated to fit
    // the budget. We mirror the drop-oldest-first / keep-newest heuristic the
    // SDK's context builder uses (and computeOmittedCount in the REST path):
    // count the leading messages that would be dropped, and the tokens they
    // carry. Only emit when something is actually dropped so the dashboard
    // count stays meaningful.
    this.emitTruncationEventIfNeeded(rows, tokensBudget, input);

    return { tokensUsed, tokensBudget };
  }

  /**
   * Compute how many leading (oldest) messages and tokens would be dropped to
   * fit `tokensBudget` (keeping the newest message even if it alone exceeds
   * the budget — the just-sent prompt is never dropped), and emit a structured
   * `chat.context.truncated` warning when the count is > 0.
   */
  private emitTruncationEventIfNeeded(
    rows: Array<{ content: string }>,
    tokensBudget: number,
    input: ContextMeterInput,
  ): void {
    if (rows.length <= 1) return;
    let runningTokens = 0;
    let keepCount = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const cost = estimateTokens(rows[i]!.content);
      if (keepCount === 0) {
        runningTokens = cost;
        keepCount = 1;
        continue;
      }
      if (runningTokens + cost > tokensBudget) break;
      runningTokens += cost;
      keepCount += 1;
    }
    const turnsDropped = rows.length - keepCount;
    if (turnsDropped <= 0) return;

    let tokensDropped = 0;
    for (let i = 0; i < turnsDropped; i++) {
      tokensDropped += estimateTokens(rows[i]!.content);
    }

    this.logger.warn(
      `chat.context.truncated conversationId=${input.conversationId}` +
        (input.messageId ? ` messageId=${input.messageId}` : '') +
        ` turns_dropped=${turnsDropped} tokens_dropped=${tokensDropped} tokens_budget=${tokensBudget}`,
    );
  }
}
