// Conversations REST DTOs — request and response shapes.
//
// All endpoints are user-scoped via the session cookie; bodies never include
// userId — the controller derives it from req.user.
//
// chat-context-and-ux-polish backbone additions (LLD Tasks 10/12/14/88):
//   - MessageListResponseSchema gains optional `tokensUsed`/`tokensBudget`
//     for the per-conversation context meter, and the `pinFallback` +
//     `previouslyPinned` read-time downgrade signals.
//   - UpdateConversationRequestSchema accepts `pinnedProvider`/`pinnedModel`
//     with a coupling rule (both present or both null — single-side patches
//     are rejected to keep the persisted pair atomic).
//   - ConversationDtoSchema exposes optional nullable pin fields so the
//     picker can render the current pin state.
import { z } from 'zod';

const TitleSchema = z.string().min(1).max(200);

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const CreateConversationRequestSchema = z.object({
  title: TitleSchema,
});
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

// chat-context-and-ux-polish LLD Task 12 — pin coupling.
//
// Coupling contract:
//   - Title is optional (rename is still allowed).
//   - pinnedProvider + pinnedModel must move together: both present-as-strings
//     (set the pin) OR both explicitly null (clear the pin) OR both omitted
//     (no-op). Asymmetric patches are rejected so the persisted columns can
//     never end up half-set.
//   - Empty strings are rejected for either pin field (callers must use null
//     to clear). This avoids a footgun where `""` lands in the DB and looks
//     pinned-to-nothing.
//   - The controller (LLD Task 79) further validates non-null pins against
//     the live catalog before persisting.
const PinFieldSchema = z.string().min(1).nullable().optional();

export const UpdateConversationRequestSchema = z
  .object({
    title: TitleSchema.optional(),
    pinnedProvider: PinFieldSchema,
    pinnedModel: PinFieldSchema,
  })
  .refine(
    (data) => {
      const providerKey = Object.prototype.hasOwnProperty.call(data, 'pinnedProvider');
      const modelKey = Object.prototype.hasOwnProperty.call(data, 'pinnedModel');
      // Both omitted → fine (title-only or no-op PATCH).
      if (!providerKey && !modelKey) return true;
      // Exactly one present → coupling violation.
      if (providerKey !== modelKey) return false;
      // Both present — must agree on null-ness.
      const p = data.pinnedProvider;
      const m = data.pinnedModel;
      const pIsNull = p === null;
      const mIsNull = m === null;
      return pIsNull === mIsNull;
    },
    {
      message:
        'pinnedProvider and pinnedModel must move together (both strings, both null, or both omitted)',
      path: ['pinnedProvider'],
    },
  );
export type UpdateConversationRequest = z.infer<typeof UpdateConversationRequestSchema>;

// ---------------------------------------------------------------------------
// DTOs (responses)
// ---------------------------------------------------------------------------

// chat-context-and-ux-polish LLD Task 14 — pin fields on the DTO so the
// picker can render the current pin state on read.
export const ConversationDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string(), // ISO-8601
  lastMessageAt: z.string().nullable(),
  pinnedProvider: z.string().nullable().optional(),
  pinnedModel: z.string().nullable().optional(),
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

// Read-time downgrade signal used when a persisted pin no longer points at a
// live catalog entry. Carried alongside the messages list (LLD Task 88) so
// the picker can show the dropped pair and prompt the user to repin.
export const PreviouslyPinnedSchema = z.object({
  provider: z.string(),
  model: z.string(),
});
export type PreviouslyPinned = z.infer<typeof PreviouslyPinnedSchema>;

export const MessageListResponseSchema = z.object({
  messages: z.array(MessageDtoSchema),
  // Number of older messages omitted from the returned page because of the
  // context window cap (HLD D6). Used by the "N earlier messages omitted
  // from context" indicator in the chat UI (frontend-web Task 42).
  // Optional so an older backend that hasn't wired it yet still parses.
  omittedCount: z.number().int().nonnegative().optional(),
  // chat-context-and-ux-polish LLD Task 10 — context-meter fields.
  // HLD D5: populated only when the meter compute succeeded; the controller
  // (Tasks 81/84) wraps the meter in try/catch and omits both fields on
  // throw. Optional so a pre-meter backend still parses.
  tokensUsed: z.number().int().nonnegative().optional(),
  tokensBudget: z.number().int().nonnegative().optional(),
  // chat-context-and-ux-polish LLD Task 88 — read-time pin-fallback downgrade
  // signals. `pinFallback === true` means the persisted pin is no longer in
  // the live catalog; `previouslyPinned` names what was dropped so the picker
  // can prompt the user to repin. Persisted columns are NOT mutated — the
  // next PATCH (clear or pick anew) is the only writer.
  pinFallback: z.boolean().optional(),
  previouslyPinned: PreviouslyPinnedSchema.optional(),
});
export type MessageListResponse = z.infer<typeof MessageListResponseSchema>;
