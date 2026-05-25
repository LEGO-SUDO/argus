// SSE encode helpers. The wire shapes live in @argus/contracts; this file is
// just the text-protocol framing the LiveController writes to the response.
import type { SseTick, LiveBadgeState, InferenceKind } from '@argus/contracts';

/** Build a `tick` SSE event from the decoded live-events payload. */
export function toSseTick(userId: string, kind: InferenceKind, conversationId: string): SseTick {
  return { type: 'tick', user_id: userId, kind, conversation_id: conversationId };
}

/** Frame any JSON-serializable payload as a single SSE `data:` event. */
export function encodeSseData(payload: SseTick | LiveBadgeState | Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Frame an SSE comment line (used for keep-alive pings). */
export function encodeSseComment(text: string): string {
  return `: ${text}\n\n`;
}
