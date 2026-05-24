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
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
} from '@argus/contracts';
import { SessionGuard, AuthenticatedRequest } from '../auth/session.guard';
import { ConversationsRepository, ConversationRow } from './conversations.repository';
import { MessagesRepository, MessageRow } from './messages.repository';
import { CreateConversationRequestSchema } from './dto/create-conversation.dto';
import { UpdateConversationRequestSchema } from './dto/update-conversation.dto';
import { computeOmittedCount } from './context-window';

function toConversationDto(row: ConversationRow): ConversationDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
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
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
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
  async rename(
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
    const ok = await this.conversations.rename(id, req.user!.id, parsed.data.title);
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
    const conv = await this.conversations.getByIdForUser(id, req.user!.id);
    if (!conv) {
      throw new NotFoundException({
        error: { code: 'not_found', message: 'Conversation not found' },
      });
    }
    const rows = await this.messages.listForConversation(id, req.user!.id);
    // Compute how many older messages would be dropped from the SDK's context
    // window — surfaces as "N earlier messages omitted from context" in the
    // chat UI (frontend-web Task 42). The real SDK (when wired) owns the
    // canonical context builder; for Phase A we mirror its heuristic
    // (oldest-first drop, token-cap from CONTEXT_TOKEN_BUDGET env, default
    // 6000) so the UI indicator is correct on first paint. The web client
    // already tolerates an omitted `omittedCount` field (schema is optional),
    // so the field is omitted entirely when zero — keeps the response shape
    // tight and matches the "indicator only when relevant" UI contract.
    const omittedCount = computeOmittedCount(rows);
    return {
      messages: rows.map(toMessageDto),
      ...(omittedCount > 0 ? { omittedCount } : {}),
    };
  }
}
