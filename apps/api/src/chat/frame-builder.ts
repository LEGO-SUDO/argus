// Pure helpers returning typed WS outbound frames.
//
// Tasks 34/36/38. All builders return objects validating against the schemas
// exported from packages/contracts so that downstream consumers (web client,
// future tests) can trust the wire shape without re-parsing.
//
// The builders deliberately do not import or interact with packages/sdk —
// they're pure data factories.
import type {
  WsStartFrame,
  WsTokenFrame,
  WsEndFrame,
  WsEndStatus,
  WsErrorFrame,
  WsCancelAckFrame,
} from '@argus/contracts';

export interface StartFrameInput {
  messageId: string;
  conversationId: string;
  provider: string;
  model: string;
}

export function buildStartFrame(input: StartFrameInput): WsStartFrame {
  return {
    type: 'start',
    messageId: input.messageId,
    conversationId: input.conversationId,
    provider: input.provider,
    model: input.model,
    seq: 0,
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

export function buildEndFrame(messageId: string, seq: number, status: WsEndStatus): WsEndFrame {
  return {
    type: 'end',
    messageId,
    seq,
    status,
  };
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
