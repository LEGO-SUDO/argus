// WS frame envelopes — wire contract between web client and apps/api gateway.
//
// HLD D2 reference. Two directions:
//
//   inbound  (client → server):
//     - send      kick off a turn against an existing conversation
//     - cancel    request server stop streaming an in-flight message
//
//   outbound (server → client):
//     - start         identity-only: messageId, conversationId, seq=0 (no provider/model)
//     - metadata      seq=1; carries `providerMeta { provider, model, ... }`
//                     EXACTLY ONCE per turn, on the SDK `commit` chunk
//                     (chat-context-and-ux-polish backbone LLD Task 4/6,
//                      Preamble §1: commit is the final provider+model,
//                      Preamble §2: metadata is exactly-once, sourced from commit).
//     - token         next chunk of assistant content (seq 2..N)
//     - end           terminal frame; status (complete | canceled | failed);
//                     optional `tokensUsed` + `tokensBudget` populated only when
//                     `status: 'complete'` per HLD D5; orchestrator gates this
//                     (Tasks 7/8/57/59) — schema only declares the optional shape.
//     - error         provider/server-side error (always followed by an `end`)
//     - cancel-ack    acknowledges receipt of a cancel request
//
// Per-message seq invariant after this backbone (Task 4):
//   start@0 → metadata@1 → token@2..N → terminal (end/error/cancel-ack)
//
// Pre-token failure path (Preamble §3): start@0 → error → end(failed).
// No metadata frame ever leaks before the error.
import { z } from 'zod';

// Path the @WebSocketGateway is mounted on. Web client and any wscat smoke
// test must dial this exact path.
export const WS_PATH = '/ws/chat';

// ---------------------------------------------------------------------------
// Inbound (client → server)
// ---------------------------------------------------------------------------

// chat-context-and-ux-polish (integration review — first-turn pin race).
// Optional pin fields on the send frame so the FIRST turn of a brand-new
// conversation can honor the picker selection. Without this, the frontend
// holds the pin and PATCHes /conversations/:id only AFTER the `start` frame
// mints the conversation — but the gateway already read the (null) persisted
// pin and streamed with Auto/failover, so the pin only takes effect from turn
// 2. Carrying the pin on the send frame closes that race.
//
// Coupling rule mirrors UpdateConversationRequestSchema (conversations.ts):
// pinnedProvider + pinnedModel must move together — both present as non-empty
// strings (carry a pin) OR both omitted (Auto). Unlike the PATCH body, NULL is
// NOT accepted here: a send either carries a pin or it doesn't, so "Auto" is
// expressed by omitting both, never by sending null. Empty strings are
// rejected (a footgun — `""` is not a real model id).
const SendPinFieldSchema = z.string().min(1).optional();

// Shared coupling predicate so BOTH the standalone `WsSendFrameSchema` AND the
// inbound discriminated-union variant enforce it. (Zod 3's
// `z.discriminatedUnion` rejects a refined object as a member — `ZodEffects`
// has no `.shape` — so the union member stays the raw object below and the
// union is re-refined. Same shape as the end-frame handling further down.)
const sendPinCouplingValid = (data: {
  pinnedProvider?: string;
  pinnedModel?: string;
}): boolean => {
  // Both omitted → fine (Auto). Both present → fine (carry a pin).
  // Exactly one present → coupling violation. (Empty strings already fail the
  // field-level .min(1); a present-but-empty value can't reach here.)
  const hasProvider = data.pinnedProvider !== undefined;
  const hasModel = data.pinnedModel !== undefined;
  return hasProvider === hasModel;
};

const SEND_PIN_COUPLING_REFINE_OPTS: { message: string; path: (string | number)[] } = {
  message:
    'pinnedProvider and pinnedModel must move together (both non-empty strings, or both omitted)',
  path: ['pinnedProvider'],
};

// Raw object — used as the inbound discriminated-union member (must stay a
// ZodObject so the union can discriminate on `type`).
const WsSendFrameObjectSchema = z.object({
  type: z.literal('send'),
  // Null for the FIRST turn of a brand-new conversation — the gateway mints
  // both the conversation row and `message_id`, then surfaces the freshly
  // minted conversation id on the next `start` frame so the web client can
  // `router.replace(/chat/<id>)` (frontend-web LLD Tasks 52 + 54). Once a
  // conversation exists, every subsequent send carries its UUID.
  conversationId: z.string().uuid().nullable(),
  // The user-authored content for this turn. The server mints `message_id`
  // — client never assigns one (HLD D1 — gateway is sole minter).
  content: z.string().min(1).max(64_000),
  // Optional pin for THIS turn (see block comment above). When present, the
  // gateway validates it against the live catalog, uses it as the turn's SDK
  // override, and persists it onto the conversation row so turn 2+ flow
  // through the existing persisted-pin path.
  pinnedProvider: SendPinFieldSchema,
  pinnedModel: SendPinFieldSchema,
});

// Standalone send-frame schema — carries the coupling constraint.
export const WsSendFrameSchema = WsSendFrameObjectSchema.refine(
  sendPinCouplingValid,
  SEND_PIN_COUPLING_REFINE_OPTS,
);
export type WsSendFrame = z.infer<typeof WsSendFrameObjectSchema>;

export const WsCancelFrameSchema = z.object({
  type: z.literal('cancel'),
  // The assistant `message_id` previously delivered in a `start` frame.
  messageId: z.string().uuid(),
});
export type WsCancelFrame = z.infer<typeof WsCancelFrameSchema>;

export const WsFrameInboundSchema = z
  .discriminatedUnion('type', [
    // Raw object member (the refined `WsSendFrameSchema` is a ZodEffects and
    // can't be a discriminated-union member). The coupling constraint is
    // re-applied at the union level below so a frame parsed through the
    // inbound union (the gateway's frame parser) enforces it too.
    WsSendFrameObjectSchema,
    WsCancelFrameSchema,
  ])
  .refine(
    (frame) => frame.type !== 'send' || sendPinCouplingValid(frame),
    SEND_PIN_COUPLING_REFINE_OPTS,
  );
export type WsFrameInbound = z.infer<typeof WsFrameInboundSchema>;

// ---------------------------------------------------------------------------
// Outbound (server → client)
// ---------------------------------------------------------------------------

// .strict() so the contract test (Task 1) can assert provider/model rejection.
// Identity-only after the backbone — provider/model migrated to the metadata
// frame below (Task 2 + 4).
export const WsStartFrameSchema = z
  .object({
    type: z.literal('start'),
    messageId: z.string().uuid(),
    conversationId: z.string().uuid(),
    // Always 0 for start frames.
    seq: z.literal(0),
  })
  .strict();
export type WsStartFrame = z.infer<typeof WsStartFrameSchema>;

// Inner `providerMeta` shape. `.passthrough()` (per LLD Codex-vagueness fix:
// "Zod open-shape policy for providerMeta: use .passthrough()") so the
// `commit`-chunk's optional fields (promptTokens, completionTokens, etc.)
// land in the parsed object without forcing a contract revision each time
// the SDK adds a sibling key.
export const WsMetadataProviderMetaSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
  })
  .passthrough();
export type WsMetadataProviderMeta = z.infer<typeof WsMetadataProviderMetaSchema>;

// Metadata frame — emits EXACTLY ONCE per turn at seq=1, sourced from the SDK
// `commit` chunk (LLD Preamble §2). `seq` is pinned to the literal 1 (LLD
// Task 5/6) so the per-message frame ordering stays a property the schema
// enforces, not just a runtime invariant.
export const WsMetadataFrameSchema = z.object({
  type: z.literal('metadata'),
  messageId: z.string().uuid(),
  // chat-context-and-ux-polish LLD Task 6: literal 1.
  seq: z.literal(1),
  providerMeta: WsMetadataProviderMetaSchema,
});
export type WsMetadataFrame = z.infer<typeof WsMetadataFrameSchema>;

export const WsTokenFrameSchema = z.object({
  type: z.literal('token'),
  messageId: z.string().uuid(),
  // Monotonic, strictly increasing from 1. Token frames start at seq=2 in the
  // backbone since metadata claims seq=1, but the schema's lower bound stays
  // at 1 to keep backward-compat (pre-metadata clients shouldn't break on a
  // theoretical no-metadata turn — orchestrator enforces start→metadata→token
  // ordering at runtime).
  seq: z.number().int().min(1),
  content: z.string(),
});
export type WsTokenFrame = z.infer<typeof WsTokenFrameSchema>;

export const WsEndStatusSchema = z.enum(['complete', 'canceled', 'failed']);
export type WsEndStatus = z.infer<typeof WsEndStatusSchema>;

// chat-context-and-ux-polish (Codex review — schema-level enforcement): the
// context fields are valid ONLY on `status: 'complete'`. HLD D5 reserves them
// for the complete terminal; a `failed`/`canceled` end frame carrying
// tokensUsed/tokensBudget is a contract violation, not just a runtime one.
// Pin the constraint in the schema so a future caller can't ship them on a
// non-complete terminal without the parse failing.
//
// We keep the constraint as a shared predicate so BOTH the standalone
// `WsEndFrameSchema` AND the discriminated-union variant enforce it. (Zod 3's
// `z.discriminatedUnion` rejects a refined object as a member — `ZodEffects`
// has no `.shape` — so the union member stays a raw object and the union is
// re-refined below.)
const endContextFieldsValid = (data: {
  status: WsEndStatus;
  tokensUsed?: number;
  tokensBudget?: number;
}): boolean =>
  data.status === 'complete' ||
  (data.tokensUsed === undefined && data.tokensBudget === undefined);

const END_CONTEXT_REFINE_OPTS: { message: string; path: (string | number)[] } = {
  message: 'tokensUsed/tokensBudget are only valid when status is "complete"',
  path: ['tokensUsed'],
};

// Raw object — used as the discriminated-union member (must stay a ZodObject).
const WsEndFrameObjectSchema = z.object({
  type: z.literal('end'),
  messageId: z.string().uuid(),
  // Terminal seq — greater than every token seq emitted for this message.
  seq: z.number().int().min(1),
  status: WsEndStatusSchema,
  // chat-context-and-ux-polish LLD Task 7/8: optional non-negative integer
  // context fields. Populated only when `status: 'complete'` per HLD D5;
  // orchestrator-side enforcement lives in apps/api (Tasks 57/59 gate the
  // meter call to the complete terminal path).
  tokensUsed: z.number().int().nonnegative().optional(),
  tokensBudget: z.number().int().nonnegative().optional(),
});

// Standalone end-frame schema — carries the cross-field constraint.
export const WsEndFrameSchema = WsEndFrameObjectSchema.refine(
  endContextFieldsValid,
  END_CONTEXT_REFINE_OPTS,
);
export type WsEndFrame = z.infer<typeof WsEndFrameObjectSchema>;

export const WsErrorFrameSchema = z.object({
  type: z.literal('error'),
  messageId: z.string().uuid(),
  errorCode: z.string(),
  message: z.string().optional(),
});
export type WsErrorFrame = z.infer<typeof WsErrorFrameSchema>;

export const WsCancelAckFrameSchema = z.object({
  type: z.literal('cancel-ack'),
  messageId: z.string().uuid(),
});
export type WsCancelAckFrame = z.infer<typeof WsCancelAckFrameSchema>;

export const WsFrameOutboundSchema = z
  .discriminatedUnion('type', [
    WsStartFrameSchema,
    WsMetadataFrameSchema,
    WsTokenFrameSchema,
    WsEndFrameObjectSchema,
    WsErrorFrameSchema,
    WsCancelAckFrameSchema,
  ])
  // Re-apply the end-frame context-field constraint at the union level so a
  // frame parsed through the outbound union (e.g. the web client) enforces it
  // too — the union member is the raw object, which can't carry the refine.
  .refine(
    (frame) => frame.type !== 'end' || endContextFieldsValid(frame),
    END_CONTEXT_REFINE_OPTS,
  );
export type WsFrameOutbound = z.infer<typeof WsFrameOutboundSchema>;

// Union of every frame type — useful for tests and exhaustive switches.
export const WsFrameSchema = z.union([WsFrameInboundSchema, WsFrameOutboundSchema]);
export type WsFrame = z.infer<typeof WsFrameSchema>;
