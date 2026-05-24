// Pure helpers returning typed WS outbound frames.
//
// All builders return objects validating against the schemas exported from
// packages/contracts so that downstream consumers (web client, future tests)
// can trust the wire shape without re-parsing.
//
// chat-context-and-ux-polish backbone (LLD Tasks 37/57):
//   - `buildStartFrame` is identity-only — provider/model migrated to the new
//     `buildMetadataFrame` (Task 37, matches Task 2's contract drop).
//   - `buildMetadataFrame` ships the `providerMeta` payload that the SDK
//     `commit` chunk surfaced. Orchestrator emits exactly once at seq=1
//     (LLD Preamble §2).
//   - `buildEndFrame` accepts optional context-token fields (Task 8).
//     Orchestrator gates emission to `status: 'complete'` only (Task 57/59).
//
// The builders deliberately do not import or interact with packages/sdk —
// they're pure data factories.
import type {
  WsStartFrame,
  WsMetadataFrame,
  WsMetadataProviderMeta,
  WsTokenFrame,
  WsEndFrame,
  WsEndStatus,
  WsErrorFrame,
  WsCancelAckFrame,
} from '@argus/contracts';

export interface StartFrameInput {
  messageId: string;
  conversationId: string;
}

export function buildStartFrame(input: StartFrameInput): WsStartFrame {
  return {
    type: 'start',
    messageId: input.messageId,
    conversationId: input.conversationId,
    seq: 0,
  };
}

export function buildMetadataFrame(
  messageId: string,
  // Accept any object with the required provider+model strings; the
  // contract's `.passthrough()` allows arbitrary sibling keys (LLD Task 4).
  // We don't tighten to `WsMetadataProviderMeta` here because the orchestrator
  // forwards the SDK's `ProviderMeta` shape directly — structurally the same
  // pair plus optional token counts — and TS won't widen from a closed shape
  // to an index-signatured one without an explicit cast.
  providerMeta: { provider: string; model: string; [k: string]: unknown },
): WsMetadataFrame {
  // seq is literal 1 — pinned in the contract (LLD Task 6) and load-bearing
  // on the orchestrator's start@0 → metadata@1 → token@2..N ordering.
  return {
    type: 'metadata',
    messageId,
    seq: 1,
    providerMeta: providerMeta as WsMetadataProviderMeta,
  };
}

export function buildTokenFrame(messageId: string, seq: number, content: string): WsTokenFrame {
  return {
    type: 'token',
    messageId,
    seq,
    content,
  };
}

export interface EndFrameContextFields {
  tokensUsed: number;
  tokensBudget: number;
}

export function buildEndFrame(
  messageId: string,
  seq: number,
  status: WsEndStatus,
  context?: EndFrameContextFields,
): WsEndFrame {
  // Both context-token fields ship together or not at all — the contract
  // accepts either as independently optional, but the orchestrator only
  // calls this with both populated (HLD D5 + LLD Task 57/59 — only the
  // `complete` terminal carries them).
  const base: WsEndFrame = {
    type: 'end',
    messageId,
    seq,
    status,
  };
  if (context) {
    base.tokensUsed = context.tokensUsed;
    base.tokensBudget = context.tokensBudget;
  }
  return base;
}

export function buildErrorFrame(
  messageId: string,
  errorCode: string,
  message?: string,
): WsErrorFrame {
  return {
    type: 'error',
    messageId,
    errorCode,
    ...(message !== undefined ? { message } : {}),
  };
}

export function buildCancelAckFrame(messageId: string): WsCancelAckFrame {
  return {
    type: 'cancel-ack',
    messageId,
  };
}
