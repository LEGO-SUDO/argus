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
import { Inject, Injectable } from '@nestjs/common';
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
}

@Injectable()
export class ContextMeterService {
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
        // Only `content` is read for the meter. Avoid pulling the full row
        // shape so a future column add doesn't bloat this query.
        // (InMemoryPrisma's findMany doesn't honor `select` but production
        // does; tests don't rely on field count.)
      }),
      this.prisma.db.conversation.findFirst({
        where: { id: input.conversationId, userId: input.userId },
      }),
    ]);

    let tokensUsed = 0;
    for (const m of messages as Array<{ content: string }>) {
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

    return { tokensUsed, tokensBudget };
  }
}
