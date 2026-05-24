// REST CRUD for /conversations.
//
// Every method:
//   - Guarded by SessionGuard (cookie → req.user.id)
//   - Reads userId off req.user — never trusts a body field
//   - Returns DTOs from packages/contracts (ConversationDto, MessageDto)
//
// Cross-user requests resolve to 404 (we don't differentiate
// not-found-for-anyone vs not-found-for-you to avoid leaking conversation
// id existence to a different user).
//
// chat-context-and-ux-polish backbone (LLD Tasks 77-89):
//   - PATCH accepts pin fields (with the coupling rule already enforced by
//     UpdateConversationRequestSchema); validates non-null pins against the
//     live SDK catalog before persisting (LLD Task 79); rejects unknown
//     pairs with 400 + `invalid_pin`.
//   - GET /:id/messages calls ContextMeterService inside try/catch and
//     surfaces the result at the response root (LLD Tasks 81/84). Meter
//     throws are non-fatal — the messages list still ships.
//   - GET /:id/messages also runs the fallback resolver (LLD Task 89): if
//     the persisted pin is no longer in the live catalog, the conversation
//     DTO carries both pin fields as null in the response and the response
//     root surfaces `pinFallback: true` + `previouslyPinned`. The persisted
//     row is NOT mutated — the next PATCH writes.
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  ConversationDto,
  ConversationListResponse,
  MessageListResponse,
  PreviouslyPinned,
} from '@argus/contracts';
import { SessionGuard, AuthenticatedRequest } from '../auth/session.guard';
import { ConversationsRepository, ConversationRow } from './conversations.repository';
import { MessagesRepository, MessageRow } from './messages.repository';
import { CreateConversationRequestSchema } from './dto/create-conversation.dto';
import { UpdateConversationRequestSchema } from './dto/update-conversation.dto';
import { computeOmittedCount } from './context-window';
import { ContextMeterService } from '../chat/context-meter.service';
import { SDK_CATALOG, type SdkCatalogAccessor } from '../common/sdk-catalog.provider';
import { captureApiError } from '../observability/sentry';

function toConversationDto(row: ConversationRow): ConversationDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    // chat-context-and-ux-polish LLD Task 14/77 — pin fields on the DTO so
    // the picker can render the current pin state on read.
    pinnedProvider: row.pinnedProvider ?? null,
    pinnedModel: row.pinnedModel ?? null,
  };
}

function toMessageDto(row: MessageRow): MessageListResponse['messages'][number] {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    // Hydrated from the latest `inferences` row by MessagesRepository.
    // Frontend-web Retry UX (Task 45) keys off `errorCode === 'client_disconnected'`;
    // Task 43 renders provider/model per-message labels for assistant turns.
    errorCode: row.errorCode,
    provider: row.provider,
    model: row.model,
  };
}

@Controller('conversations')
@UseGuards(SessionGuard)
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly contextMeter: ContextMeterService,
    @Inject(SDK_CATALOG) private readonly catalog: SdkCatalogAccessor,
  ) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest): Promise<ConversationListResponse> {
    const userId = req.user!.id;
    const rows = await this.conversations.listForUser(userId);
    return { conversations: rows.map(toConversationDto) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ConversationDto> {
    const parsed = CreateConversationRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      });
    }
    const row = await this.conversations.create(req.user!.id, parsed.data.title);
    return toConversationDto(row);
  }

  @Patch(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ConversationDto> {
    const parsed = UpdateConversationRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      });
    }
    // chat-context-and-ux-polish LLD Task 79 (Codex review #2) — validate
    // non-null pins against the LIVE picker catalog (`listConfiguredProviders`)
    // BEFORE persisting (no partial writes on rejection). The previous
    // implementation used `getCatalogEntry` (cost.ts pricebook) which accepts
    // any pricebook-known model regardless of whether the provider's API key
    // is actually configured — a pin to e.g. `openai:gpt-4o-mini` was accepted
    // even when OPENAI_API_KEY was unset. The picker UI uses
    // `listConfiguredProviders` (which gates by `isConfigured()` + the
    // MOCK_PROVIDER toggle), so this is the right source of truth.
    const patch = parsed.data;
    if (patch.pinnedProvider && patch.pinnedModel) {
      if (!isInLiveCatalog(this.catalog, patch.pinnedProvider, patch.pinnedModel)) {
        throw new BadRequestException({
          error: {
            code: 'invalid_pin',
            message: `pin (${patch.pinnedProvider}, ${patch.pinnedModel}) is not in the live catalog`,
          },
        });
      }
    }
    const ok = await this.conversations.update(id, req.user!.id, patch);
    if (!ok) {
      throw new NotFoundException({
        error: { code: 'not_found', message: 'Conversation not found' },
      });
    }
    const row = await this.conversations.getByIdForUser(id, req.user!.id);
    if (!row) {
      throw new NotFoundException({
        error: { code: 'not_found', message: 'Conversation not found' },
      });
    }
    return toConversationDto(row);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    const ok = await this.conversations.delete(id, req.user!.id);
    if (!ok) {
      throw new NotFoundException({
        error: { code: 'not_found', message: 'Conversation not found' },
      });
    }
  }

  @Get(':id/messages')
  async listMessages(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<MessageListResponse> {
    const userId = req.user!.id;
    const conv = await this.conversations.getByIdForUser(id, userId);
    if (!conv) {
      throw new NotFoundException({
        error: { code: 'not_found', message: 'Conversation not found' },
      });
    }
    const rows = await this.messages.listForConversation(id, userId);
    // Compute how many older messages would be dropped from the SDK's context
    // window — surfaces as "N earlier messages omitted from context" in the
    // chat UI (frontend-web Task 42). The real SDK (when wired) owns the
    // canonical context builder; for Phase A we mirror its heuristic via
    // common/token-heuristic (oldest-first drop, default budget 10000).
    const omittedCount = computeOmittedCount(rows);

    // chat-context-and-ux-polish LLD Task 89 (Codex review #2/#3) — read-time
    // pin-fallback resolver. Persisted pin no longer in the LIVE picker
    // catalog (`listConfiguredProviders` — same source the picker UI shows,
    // gates by `isConfigured()` + MOCK_PROVIDER) → response DTO shows null
    // pin + `pinFallback: true` + `previouslyPinned`. Persisted row is NOT
    // mutated; the next PATCH (clear or pick anew) writes.
    let pinFallback = false;
    let previouslyPinned: PreviouslyPinned | undefined;
    let conversationForDto = conv;
    if (conv.pinnedProvider && conv.pinnedModel) {
      if (!isInLiveCatalog(this.catalog, conv.pinnedProvider, conv.pinnedModel)) {
        pinFallback = true;
        previouslyPinned = {
          provider: conv.pinnedProvider,
          model: conv.pinnedModel,
        };
        // HLD §Observability — structured pin-fallback event (queryable in
        // Jaeger/log search). Emitted only on the fallback transition; non-
        // fallback reads stay silent so the dashboard count is meaningful.
        this.logger.warn(
          `conversation.pin.fallback conversationId=${id} previousProvider=${conv.pinnedProvider} previousModel=${conv.pinnedModel}`,
        );
        // Effective view: null pins on the DTO so the picker doesn't render
        // a stale pin. The row itself stays put — explicit re-PATCH is the
        // only writer.
        conversationForDto = { ...conv, pinnedProvider: null, pinnedModel: null };
      }
    }

    // chat-context-and-ux-polish LLD Tasks 81/84 — meter try/catch. On
    // success include both context fields; on failure log via the existing
    // Sentry helper and OMIT both (resilience — server log only, never
    // break the read).
    let tokensUsed: number | undefined;
    let tokensBudget: number | undefined;
    try {
      const m = await this.contextMeter.compute({ conversationId: id, userId });
      tokensUsed = m.tokensUsed;
      tokensBudget = m.tokensBudget;
    } catch (err) {
      captureApiError({
        err,
        feature: 'conversations',
        layer: 'controller',
        extra: {
          stage: 'context-meter-compute',
          conversationId: id,
        },
      });
    }

    // chat-context-and-ux-polish LLD Task 86 (Codex review #6) — surface the
    // conversation DTO on the response root using the EFFECTIVE view (the
    // mutated `conversationForDto`). When a pin falls back, the DTO carries
    // both pin fields as null so the picker doesn't render the dropped pair.
    // The persisted row stays put; only the wire representation is patched.
    return {
      conversation: toConversationDto(conversationForDto),
      messages: rows.map(toMessageDto),
      ...(omittedCount > 0 ? { omittedCount } : {}),
      ...(tokensUsed !== undefined ? { tokensUsed } : {}),
      ...(tokensBudget !== undefined ? { tokensBudget } : {}),
      ...(pinFallback ? { pinFallback: true } : {}),
      ...(previouslyPinned ? { previouslyPinned } : {}),
    };
  }
}

/**
 * Validate a (provider, model) pair against the LIVE picker catalog (the same
 * source the picker UI consults via `GET /providers`). Both the PATCH-time
 * validator and the read-time fallback resolver use this — the catalog gates
 * by `isConfigured()` + the MOCK_PROVIDER toggle, so a pricebook-known
 * provider with no API key is correctly rejected here.
 */
function isInLiveCatalog(
  catalog: SdkCatalogAccessor,
  provider: string,
  model: string,
): boolean {
  const live = catalog.listConfiguredProviders();
  return live.some((entry) => entry.provider === provider && entry.model === model);
}
