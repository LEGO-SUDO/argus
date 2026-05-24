// Unit tests for the message stream reducer.
//
// Covers LLD Tasks 3-16 + 42 + 57:
//   - init action: hydrates messages, streaming=null, omittedCount
//   - start frame: opens a streaming bubble, records provider+model
//   - token frame: appends delta; drops out-of-order seqs
//   - end frame: promotes streaming bubble to complete, re-enables composer
//   - error frame (with active stream): marks message failed, canRetry=true,
//     records error_code, re-enables composer
//   - error frame (no active stream): records top-level terminalError when
//     error_code === 'no_providers_available'
//   - canceled (end-frame with status=canceled): preserves partial content
//   - late tokens after terminal: dropped
//   - composer-submitted action: appends user message, locks composer; second
//     dispatch while locked is ignored; terminal frames release the lock
//
// The reducer is pure and React-free — these tests import the module directly
// without rendering any component.
import {
  reducer,
  initialState,
  type Message,
  type State,
} from '@/lib/message-stream-reducer';
import type {
  WsEndFrame,
  WsErrorFrame,
  WsStartFrame,
  WsTokenFrame,
} from '@argus/contracts';

const MSG_ID = '11111111-1111-4111-8111-111111111111';
const CONV_ID = '22222222-2222-4222-8222-222222222222';

function makeStart(overrides: Partial<WsStartFrame> = {}): WsStartFrame {
  return {
    type: 'start',
    messageId: MSG_ID,
    conversationId: CONV_ID,
    provider: 'mock',
    model: 'mock-1',
    seq: 0,
    ...overrides,
  };
}

function makeToken(seq: number, content: string, messageId = MSG_ID): WsTokenFrame {
  return { type: 'token', messageId, seq, content };
}

function makeEnd(status: WsEndFrame['status'] = 'complete', messageId = MSG_ID): WsEndFrame {
  return { type: 'end', messageId, seq: 999, status };
}

function makeError(
  errorCode: string,
  messageId: string | undefined = MSG_ID,
  message?: string,
): WsErrorFrame {
  // WsErrorFrameSchema requires messageId — for the "no active stream" case
  // we still pass a synthetic messageId since the schema requires it; the
  // reducer's matching logic keys off whether the streaming bubble exists.
  return {
    type: 'error',
    messageId: messageId ?? '00000000-0000-4000-8000-000000000000',
    errorCode,
    ...(message ? { message } : {}),
  };
}

function userMsg(id: string, content: string): Message {
  return {
    id,
    role: 'user',
    content,
    status: 'complete',
  };
}

describe('message-stream-reducer', () => {
  // -------------------------------------------------------------------------
  // Tasks 3-4: init action hydrates state
  // -------------------------------------------------------------------------
  describe('init', () => {
    it('hydrates messages array and clears streaming', () => {
      const history: Message[] = [
        userMsg('u1', 'hello'),
        { id: 'a1', role: 'assistant', content: 'hi', status: 'complete' },
      ];
      const next = reducer(initialState, {
        type: 'init',
        messages: history,
        omittedCount: 0,
      });
      expect(next.messages).toEqual(history);
      expect(next.streaming).toBeNull();
      expect(next.omittedCount).toBe(0);
      expect(next.composerDisabled).toBe(false);
      expect(next.terminalError).toBeNull();
    });

    // Task 42 — init accepts omittedCount
    it('records omittedCount on init', () => {
      const next = reducer(initialState, {
        type: 'init',
        messages: [],
        omittedCount: 5,
      });
      expect(next.omittedCount).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // Tasks 5-6: start frame opens streaming bubble
  // -------------------------------------------------------------------------
  describe('start frame', () => {
    it('creates a streaming assistant bubble with provider+model recorded', () => {
      const next = reducer(initialState, { type: 'frame', frame: makeStart() });
      expect(next.streaming).not.toBeNull();
      expect(next.streaming?.id).toBe(MSG_ID);
      expect(next.streaming?.role).toBe('assistant');
      expect(next.streaming?.status).toBe('streaming');
      expect(next.streaming?.content).toBe('');
      expect(next.streaming?.provider).toBe('mock');
      expect(next.streaming?.model).toBe('mock-1');
    });
  });

  // -------------------------------------------------------------------------
  // Tasks 7-8: token frame appending with seq ordering
  // -------------------------------------------------------------------------
  describe('token frame', () => {
    it('appends deltas in seq order and ignores out-of-order seqs', () => {
      let state = reducer(initialState, { type: 'frame', frame: makeStart() });
      state = reducer(state, { type: 'frame', frame: makeToken(1, 'hel') });
      state = reducer(state, { type: 'frame', frame: makeToken(2, 'lo') });
      expect(state.streaming?.content).toBe('hello');
      // Late / replayed delivery: seq <= last applied is dropped.
      state = reducer(state, { type: 'frame', frame: makeToken(1, 'XX') });
      state = reducer(state, { type: 'frame', frame: makeToken(2, 'YY') });
      expect(state.streaming?.content).toBe('hello');
    });

    it('ignores tokens for an unknown message_id (no streaming bubble)', () => {
      const next = reducer(initialState, { type: 'frame', frame: makeToken(1, 'orphan') });
      expect(next.streaming).toBeNull();
      expect(next.messages).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Tasks 9-10: end frame promotes to complete + Task 16 re-enables composer
  // -------------------------------------------------------------------------
  describe('end frame (complete)', () => {
    it('promotes the streaming bubble to messages with status=complete and clears composer lock', () => {
      let state = reducer(initialState, {
        type: 'composer-submitted',
        userMessageId: 'u-local-1',
        text: 'hi',
      });
      state = reducer(state, { type: 'frame', frame: makeStart() });
      state = reducer(state, { type: 'frame', frame: makeToken(1, 'world') });
      state = reducer(state, { type: 'frame', frame: makeEnd('complete') });
      expect(state.streaming).toBeNull();
      const last = state.messages[state.messages.length - 1];
      expect(last?.id).toBe(MSG_ID);
      expect(last?.role).toBe('assistant');
      expect(last?.status).toBe('complete');
      expect(last?.content).toBe('world');
      expect(state.composerDisabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Tasks 11-12: error frame on active stream
  // -------------------------------------------------------------------------
  describe('error frame on active stream', () => {
    it('promotes streaming bubble to failed with canRetry=true and clears composer lock', () => {
      let state = reducer(initialState, {
        type: 'composer-submitted',
        userMessageId: 'u-local-1',
        text: 'hi',
      });
      state = reducer(state, { type: 'frame', frame: makeStart() });
      state = reducer(state, { type: 'frame', frame: makeToken(1, 'part') });
      state = reducer(state, {
        type: 'frame',
        frame: makeError('provider_error', MSG_ID, 'boom'),
      });
      expect(state.streaming).toBeNull();
      const last = state.messages[state.messages.length - 1];
      expect(last?.status).toBe('failed');
      expect(last?.canRetry).toBe(true);
      expect(last?.errorCode).toBe('provider_error');
      expect(last?.content).toBe('part');
      expect(state.composerDisabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Tasks 13-14: cancel + late-frame guard
  // -------------------------------------------------------------------------
  describe('cancel race', () => {
    it('promotes to canceled and drops late tokens for the same message_id', () => {
      let state = reducer(initialState, { type: 'frame', frame: makeStart() });
      state = reducer(state, { type: 'frame', frame: makeToken(1, 'part') });
      state = reducer(state, { type: 'frame', frame: makeEnd('canceled') });
      expect(state.streaming).toBeNull();
      const last = state.messages[state.messages.length - 1];
      expect(last?.status).toBe('canceled');
      expect(last?.content).toBe('part');

      // Late token after terminal must not re-create the bubble or mutate
      // the canceled message — HLD Regression Risk Surface invariant.
      const afterLate = reducer(state, { type: 'frame', frame: makeToken(99, 'XX') });
      expect(afterLate.streaming).toBeNull();
      const lastAfter = afterLate.messages[afterLate.messages.length - 1];
      expect(lastAfter?.content).toBe('part');
      expect(lastAfter?.status).toBe('canceled');
    });
  });

  // -------------------------------------------------------------------------
  // Tasks 15-16: composer-submitted + single-in-flight lock
  // -------------------------------------------------------------------------
  describe('composer-submitted', () => {
    it('appends user message and locks composer; second dispatch while locked is ignored', () => {
      const first = reducer(initialState, {
        type: 'composer-submitted',
        userMessageId: 'u-local-1',
        text: 'hello',
      });
      expect(first.messages).toHaveLength(1);
      expect(first.messages[0]?.role).toBe('user');
      expect(first.messages[0]?.content).toBe('hello');
      expect(first.composerDisabled).toBe(true);

      const second = reducer(first, {
        type: 'composer-submitted',
        userMessageId: 'u-local-2',
        text: 'ignored',
      });
      // State unchanged.
      expect(second).toBe(first);
    });
  });

  // -------------------------------------------------------------------------
  // Retry transcript-duplication guard: retry-clicked re-locks the composer
  // WITHOUT appending a fresh user row. Distinct action from
  // composer-submitted so the UI can show the same user message + a new
  // streaming bubble without ending up with "user, assistant-failed, user"
  // in the transcript after Retry.
  // -------------------------------------------------------------------------
  describe('retry-clicked', () => {
    it('locks the composer and clears terminalError but does NOT append a user row', () => {
      // Prime: user sent "hi", assistant failed.
      let state = reducer(initialState, {
        type: 'composer-submitted',
        userMessageId: 'u-1',
        text: 'hi',
      });
      state = reducer(state, { type: 'frame', frame: makeStart() });
      state = reducer(state, {
        type: 'frame',
        frame: makeError('provider_error', MSG_ID, 'boom'),
      });
      expect(state.composerDisabled).toBe(false);
      const messagesBefore = state.messages.length;
      // Click Retry.
      const after = reducer(state, { type: 'retry-clicked' });
      expect(after.composerDisabled).toBe(true);
      expect(after.terminalError).toBeNull();
      // No new user row appended — the original user message is still the
      // only user-authored row in the transcript.
      expect(after.messages.length).toBe(messagesBefore);
      expect(after.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    });

    it('is a no-op while another turn is already streaming', () => {
      let state = reducer(initialState, {
        type: 'composer-submitted',
        userMessageId: 'u-1',
        text: 'hi',
      });
      state = reducer(state, { type: 'frame', frame: makeStart() });
      expect(state.composerDisabled).toBe(true);
      const after = reducer(state, { type: 'retry-clicked' });
      expect(after).toBe(state);
    });
  });

  describe('local-send-failed', () => {
    it('releases the composer lock and records a terminalError banner', () => {
      // Simulate: composer was locked by a prior optimistic submit, then
      // the WS send() threw.
      const locked: State = {
        ...initialState,
        composerDisabled: true,
      };
      const after = reducer(locked, {
        type: 'local-send-failed',
        errorCode: 'send_failed',
        message: 'ws not connected',
      });
      expect(after.composerDisabled).toBe(false);
      expect(after.terminalError?.errorCode).toBe('send_failed');
      expect(after.terminalError?.message).toBe('ws not connected');
    });
  });

  // -------------------------------------------------------------------------
  // Task 57: error frame without active stream + no_providers_available
  // -------------------------------------------------------------------------
  describe('terminal error before start', () => {
    it('records terminalError when error frame arrives without an active stream and code is no_providers_available', () => {
      const state = reducer(initialState, {
        type: 'frame',
        frame: makeError('no_providers_available', undefined, 'no providers'),
      });
      expect(state.terminalError?.errorCode).toBe('no_providers_available');
      expect(state.composerDisabled).toBe(false);
    });
  });
});

// Compile-time check that the State type stays public — keeps the reducer
// module's contract surface stable for the React component.
const _stateTypeCheck: State = initialState;
void _stateTypeCheck;
