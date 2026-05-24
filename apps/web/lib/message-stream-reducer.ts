// message-stream-reducer — pure state machine for one conversation's message
// log. Drives the chat surface. Decoupled from React so it can be unit-tested
// without rendering anything.
//
// LLD references:
//   Task 3-16   per-frame and per-action transitions
//   Task 42     init carries `omittedCount`
//   Task 57     terminal error before any `start` (e.g. no_providers_available)
//
// Key invariants (HLD Regression Risk Surface):
//   - A message_id that has reached a terminal state (complete/canceled/failed)
//     is immutable. Late `token` frames for it are dropped, not appended.
//   - `composerDisabled` flips to `true` on `composer-submitted` and back to
//     `false` only on a terminal frame (`end` with any status, or `error`).
//   - The reducer is pure: same (state, action) -> same nextState reference
//     when no change applies (used by tests to assert "second submit is a
//     no-op").
//
// All identifiers stay in the contracts vocabulary (`messageId` camelCase per
// `@argus/contracts/ws`).

import type {
  WsEndFrame,
  WsErrorFrame,
  WsFrameOutbound,
  WsStartFrame,
  WsTokenFrame,
} from '@argus/contracts';

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus = 'streaming' | 'complete' | 'failed' | 'canceled';

/**
 * Message — the per-row shape rendered in the message list. Wide enough to
 * cover both user-authored messages (no provider/model) and assistant turns
 * (carry provider/model + optional errorCode on failure).
 */
export type Message = {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  provider?: string;
  model?: string;
  /** Set true on failed messages that can be retried. */
  canRetry?: boolean;
  /** WS error_code (or restored from history) — drives "interrupted" marker. */
  errorCode?: string;
  /** Highest `seq` applied for this streaming message (drops out-of-order). */
  lastAppliedSeq?: number;
};

/**
 * Streaming view of the assistant bubble currently being built up. Same shape
 * as `Message` but kept separate from `messages` so renderers can show the
 * caret animation under it without scanning the whole list.
 */
export type StreamingMessage = Message;

export type TerminalError = {
  errorCode: string;
  message?: string;
};

export type State = {
  messages: Message[];
  streaming: StreamingMessage | null;
  /** Locks the composer while an assistant turn is in flight. */
  composerDisabled: boolean;
  /** Number of older messages dropped by context cap (HLD D6 indicator). */
  omittedCount: number;
  /** Set on terminal errors that prevent a turn from starting (e.g. no providers). */
  terminalError: TerminalError | null;
};

export const initialState: State = {
  messages: [],
  streaming: null,
  composerDisabled: false,
  omittedCount: 0,
  terminalError: null,
};

// ---------------------------------------------------------------------------
// Action union — server frames + local user actions both flow through here.
// ---------------------------------------------------------------------------

export type Action =
  | {
      type: 'init';
      messages: Message[];
      omittedCount?: number;
    }
  | {
      type: 'frame';
      frame: WsFrameOutbound;
    }
  | {
      type: 'composer-submitted';
      /** Locally-generated optimistic id for the user row. */
      userMessageId: string;
      text: string;
    }
  | {
      /**
       * Retry of a previously-failed turn. Distinct from `composer-submitted`
       * because retry must NOT append a duplicate user-row to the
       * transcript — the original user message is already there, the user
       * just wants to re-issue the assistant turn. Reducer flips the
       * composer lock and clears any terminal-error banner; the component
       * dispatches this and then `client.send(...)` the same text.
       */
      type: 'retry-clicked';
    }
  | {
      /**
       * Synthetic local error — used when the consumer's outbound send()
       * throws (e.g. socket CONNECTING). Without this, the composer would
       * stay locked forever because no server-side `end`/`error` frame is
       * ever coming. The reducer treats it identically to a server-emitted
       * top-level `error` (clears lock, records terminalError banner).
       */
      type: 'local-send-failed';
      errorCode: string;
      message: string;
    };

// ---------------------------------------------------------------------------
// Reducer.
// ---------------------------------------------------------------------------

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'init':
      return {
        ...initialState,
        messages: action.messages,
        omittedCount: action.omittedCount ?? 0,
      };

    case 'composer-submitted': {
      // Single-in-flight lock — second submit while streaming is a no-op.
      // Return the SAME reference so callers can assert idempotency.
      if (state.composerDisabled) {
        return state;
      }
      const userRow: Message = {
        id: action.userMessageId,
        role: 'user',
        content: action.text,
        status: 'complete',
      };
      return {
        ...state,
        messages: [...state.messages, userRow],
        composerDisabled: true,
        // A fresh submit clears any prior terminalError banner.
        terminalError: null,
      };
    }

    case 'frame':
      return applyFrame(state, action.frame);

    case 'retry-clicked': {
      // Same single-in-flight discipline as `composer-submitted`: a click
      // while a turn is already streaming is a no-op.
      if (state.composerDisabled) {
        return state;
      }
      return {
        ...state,
        composerDisabled: true,
        terminalError: null,
      };
    }

    case 'local-send-failed': {
      // Same shape as a server-emitted terminal error (no active stream) —
      // release the composer lock + surface the banner so the user can try
      // again.
      return {
        ...state,
        composerDisabled: false,
        terminalError: {
          errorCode: action.errorCode,
          message: action.message,
        },
      };
    }
  }
}

function applyFrame(state: State, frame: WsFrameOutbound): State {
  switch (frame.type) {
    case 'start':
      return applyStart(state, frame);
    case 'token':
      return applyToken(state, frame);
    case 'end':
      return applyEnd(state, frame);
    case 'error':
      return applyError(state, frame);
    case 'cancel-ack':
      // The user-visible Cancel button can be dimmed via local state in the
      // component if desired; the reducer treats cancel-ack as informational.
      // The actual terminal transition arrives via the subsequent `end`.
      return state;
  }
}

function applyStart(state: State, frame: WsStartFrame): State {
  // If a message_id has already terminated, ignore (defense against the
  // server replaying a frame after a terminal — should never happen, but the
  // invariant is cheap to enforce).
  if (isTerminal(state, frame.messageId)) {
    return state;
  }
  const streaming: StreamingMessage = {
    id: frame.messageId,
    role: 'assistant',
    content: '',
    status: 'streaming',
    provider: frame.provider,
    model: frame.model,
    lastAppliedSeq: 0,
  };
  return {
    ...state,
    streaming,
    composerDisabled: true,
  };
}

function applyToken(state: State, frame: WsTokenFrame): State {
  // Drop if this message has terminated (HLD Regression Risk: cancel race).
  if (isTerminal(state, frame.messageId)) {
    return state;
  }
  const current = state.streaming;
  // Token for an unknown bubble (no prior start) — drop. The server should
  // never do this, but the reducer stays defensive.
  if (!current || current.id !== frame.messageId) {
    return state;
  }
  const lastSeq = current.lastAppliedSeq ?? 0;
  // Out-of-order or replayed delivery — drop.
  if (frame.seq <= lastSeq) {
    return state;
  }
  const nextStreaming: StreamingMessage = {
    ...current,
    content: current.content + frame.content,
    lastAppliedSeq: frame.seq,
  };
  return { ...state, streaming: nextStreaming };
}

function applyEnd(state: State, frame: WsEndFrame): State {
  if (isTerminal(state, frame.messageId)) {
    return state;
  }
  const current = state.streaming;
  // End without a streaming bubble — nothing to promote. Could happen on a
  // server bug or a reconnect race; treat as a no-op so the reducer stays
  // monotonic.
  if (!current || current.id !== frame.messageId) {
    return state;
  }
  const promoted: Message = {
    ...current,
    status: frame.status,
    // canRetry surfaces on failed messages so the UI can show Retry; canceled
    // and complete messages don't expose retry.
    canRetry: frame.status === 'failed',
    lastAppliedSeq: undefined,
  };
  return {
    ...state,
    streaming: null,
    messages: [...state.messages, promoted],
    composerDisabled: false,
  };
}

function applyError(state: State, frame: WsErrorFrame): State {
  // Two distinct shapes:
  //   1. error with an active streaming bubble whose id matches → promote
  //      bubble to status=failed, preserve partial content, set canRetry.
  //   2. error without an active bubble → record a terminalError banner.
  //      LLD Task 57 specifies this only happens when the gateway can't pick
  //      a provider (no_providers_available); other top-level codes still
  //      get surfaced via terminalError so the UI can render something
  //      instead of going silent.
  const current = state.streaming;
  if (current && frame.messageId && current.id === frame.messageId) {
    if (isTerminal(state, frame.messageId)) {
      return state;
    }
    const promoted: Message = {
      ...current,
      status: 'failed',
      canRetry: true,
      errorCode: frame.errorCode,
      lastAppliedSeq: undefined,
    };
    return {
      ...state,
      streaming: null,
      messages: [...state.messages, promoted],
      composerDisabled: false,
    };
  }
  // No active bubble — terminal error banner.
  return {
    ...state,
    terminalError: {
      errorCode: frame.errorCode,
      ...(frame.message !== undefined ? { message: frame.message } : {}),
    },
    composerDisabled: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function isTerminal(state: State, messageId: string): boolean {
  // A message_id is terminal if it appears in `messages` with any of the
  // terminal statuses. Streaming bubble is by definition non-terminal.
  return state.messages.some(
    (m) =>
      m.id === messageId &&
      (m.status === 'complete' || m.status === 'canceled' || m.status === 'failed'),
  );
}
