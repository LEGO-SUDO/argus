// WS frame envelopes — wire contract between web client and apps/api gateway.
//
// HLD D2 reference. Two directions:
//
//   inbound  (client → server):
//     - send      kick off a turn against an existing conversation
//     - cancel    request server stop streaming an in-flight message
//
//   outbound (server → client):
//     - start         server has accepted the turn, message_id minted, provider chosen
//     - token         next chunk of assistant content
//     - end           terminal frame; carries final status (complete | canceled | failed)
//     - error         provider/server-side error (always followed by an `end`)
//     - cancel-ack    acknowledges receipt of a cancel request
//
// All outbound frames carry `seq` — strictly monotonic per message_id starting
// at 0 (start) → 1..N (token) → terminal end/cancel-ack/error.
import { z } from 'zod';

// Path the @WebSocketGateway is mounted on. Web client and any wscat smoke
// test must dial this exact path.
export const WS_PATH = '/ws/chat';

// Provider + model values are free-text at the wire boundary — the gateway
// does not constrain which providers the SDK supports.

// ---------------------------------------------------------------------------
// Inbound (client → server)
// ---------------------------------------------------------------------------

export const WsSendFrameSchema = z.object({
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
});
export type WsSendFrame = z.infer<typeof WsSendFrameSchema>;

export const WsCancelFrameSchema = z.object({
  type: z.literal('cancel'),
  // The assistant `message_id` previously delivered in a `start` frame.
  messageId: z.string().uuid(),
});
export type WsCancelFrame = z.infer<typeof WsCancelFrameSchema>;

export const WsFrameInboundSchema = z.discriminatedUnion('type', [
  WsSendFrameSchema,
  WsCancelFrameSchema,
]);
export type WsFrameInbound = z.infer<typeof WsFrameInboundSchema>;

// ---------------------------------------------------------------------------
// Outbound (server → client)
// ---------------------------------------------------------------------------

export const WsStartFrameSchema = z.object({
  type: z.literal('start'),
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  provider: z.string(),
  model: z.string(),
  // Always 0 for start frames.
  seq: z.literal(0),
});
export type WsStartFrame = z.infer<typeof WsStartFrameSchema>;

export const WsTokenFrameSchema = z.object({
  type: z.literal('token'),
  messageId: z.string().uuid(),
  // Monotonic, strictly increasing from 1.
  seq: z.number().int().min(1),
  content: z.string(),
});
export type WsTokenFrame = z.infer<typeof WsTokenFrameSchema>;

export const WsEndStatusSchema = z.enum(['complete', 'canceled', 'failed']);
export type WsEndStatus = z.infer<typeof WsEndStatusSchema>;

export const WsEndFrameSchema = z.object({
  type: z.literal('end'),
  messageId: z.string().uuid(),
  // Terminal seq — greater than every token seq emitted for this message.
  seq: z.number().int().min(1),
  status: WsEndStatusSchema,
});
export type WsEndFrame = z.infer<typeof WsEndFrameSchema>;

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

export const WsFrameOutboundSchema = z.discriminatedUnion('type', [
  WsStartFrameSchema,
  WsTokenFrameSchema,
  WsEndFrameSchema,
  WsErrorFrameSchema,
  WsCancelAckFrameSchema,
]);
export type WsFrameOutbound = z.infer<typeof WsFrameOutboundSchema>;

// Union of every frame type — useful for tests and exhaustive switches.
export const WsFrameSchema = z.union([WsFrameInboundSchema, WsFrameOutboundSchema]);
export type WsFrame = z.infer<typeof WsFrameSchema>;
