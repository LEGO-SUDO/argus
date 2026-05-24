// Conversations REST DTOs — request and response shapes.
//
// All endpoints are user-scoped via the session cookie; bodies never include
// userId — the controller derives it from req.user.
import { z } from 'zod';

const TitleSchema = z.string().min(1).max(200);

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const CreateConversationRequestSchema = z.object({
  title: TitleSchema,
});
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

export const UpdateConversationRequestSchema = z.object({
  title: TitleSchema,
});
export type UpdateConversationRequest = z.infer<typeof UpdateConversationRequestSchema>;

// ---------------------------------------------------------------------------
// DTOs (responses)
// ---------------------------------------------------------------------------

export const ConversationDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string(), // ISO-8601
  lastMessageAt: z.string().nullable(),
});
export type ConversationDto = z.infer<typeof ConversationDtoSchema>;

export const ConversationListResponseSchema = z.object({
  conversations: z.array(ConversationDtoSchema),
});
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

// MessageStatus mirrors the Prisma enum (packages/db). We re-declare here
// to keep packages/contracts free of any @prisma/client import.
export const MessageStatusSchema = z.enum(['streaming', 'complete', 'canceled', 'failed']);
export type MessageStatusContract = z.infer<typeof MessageStatusSchema>;

export const MessageDtoSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string(),
  status: MessageStatusSchema,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  // Optional WS error code preserved when status is `failed` — frontend-web
  // Task 45 keys the "interrupted" marker + Retry button off
  // `errorCode === 'client_disconnected'`. Backend-api fills this in from
  // the corresponding `inferences.error_code` row on history hydration.
  errorCode: z.string().nullable().optional(),
  // Provider/model used for an assistant message — surfaced as a per-message
  // label in the chat UI (frontend-web Task 43). Optional because user-role
  // messages have no provider.
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
});
export type MessageDto = z.infer<typeof MessageDtoSchema>;

export const MessageListResponseSchema = z.object({
  messages: z.array(MessageDtoSchema),
  // Number of older messages omitted from the returned page because of the
  // context window cap (HLD D6). Used by the "N earlier messages omitted
  // from context" indicator in the chat UI (frontend-web Task 42).
  // Optional so an older backend that hasn't wired it yet still parses.
  omittedCount: z.number().int().nonnegative().optional(),
});
export type MessageListResponse = z.infer<typeof MessageListResponseSchema>;
