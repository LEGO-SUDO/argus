// Chat WS Gateway.
//
// Path:    /ws/chat (WS_PATH constant in @argus/contracts)
// Adapter: @nestjs/platform-ws (raw `ws` library; we don't need socket.io
//          rooms or fallbacks — the web client is browser-only and Node-ws
//          is the simplest path).
//
// Handshake auth (Task 55):
//   - handleConnection: parse cookie header off client.upgradeReq, resolve
//     userId via resolveWsUser. On miss, close with 4401 policy violation.
//   - On hit, stash userId + per-connection orchestrator registry on the
//     socket.
//
// Frame handling:
//   - Parse JSON, validate via WsFrameInboundSchema.
//   - 'send'   → ownership check on conversationId, call chat.startTurn,
//                start StreamOrchestrator.
//   - 'cancel' → look up orchestrator by messageId, call .cancel().
//   - Anything else → ignore (the schema's discriminated union rejects
//                       unknown types at parse time).
//
// Disconnect:
//   - handleDisconnect: call .onDisconnect() on every active orchestrator
//     for that connection. Release per-message seq counters.
import {
  Inject,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type { WebSocket, RawData } from 'ws';
import { ChatService } from './chat.service';
import { SeqCounterRegistry } from './seq-counter';
import { StreamOrchestrator } from './stream-orchestrator';
import { ContextMeterService } from './context-meter.service';
import { resolveWsUser } from '../auth/ws-session';
import { AuthService } from '../auth/auth.service';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { WS_PATH, WsFrameInboundSchema, type WsFrameOutbound } from '@argus/contracts';
import type { ChatStreamRequest } from '@argus/sdk';
import { captureApiError, withWsScope } from '../observability/sentry';
import { buildEndFrame, buildErrorFrame } from './frame-builder';
import { SDK_CATALOG, type SdkCatalogAccessor } from '../common/sdk-catalog.provider';
import { SDK_CHAT_STREAM, type SdkChatStreamFn } from '../common/sdk-chat.provider';
import { defaultContextBudget } from '../common/token-heuristic';

interface ChatClient extends WebSocket {
  data?: ChatClientData;
}

interface ChatClientData {
  userId: string;
  orchestrators: Map<string, StreamOrchestrator>;
}

const WS_POLICY_VIOLATION = 1008;
const WS_INTERNAL_ERROR = 1011;

@WebSocketGateway({ path: WS_PATH })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(ChatGateway.name);

  // chat-context-and-ux-polish LLD Task 65 — cached pre-flight provider
  // guess (the router priority head's `isConfigured()` name). Threaded onto
  // every SDK request as `guessProvider` so the span can compute the
  // guess/commit divergence (LLD Task 34). Computed once at module init;
  // a deployment that adds/removes provider keys at runtime would need to
  // restart to pick up the new head, which matches the existing behavior of
  // the router and is consistent with operator expectations.
  private cachedGuessProvider: string | null = null;

  constructor(
    private readonly chatService: ChatService,
    private readonly seqRegistry: SeqCounterRegistry,
    private readonly auth: AuthService,
    private readonly conversations: ConversationsRepository,
    private readonly contextMeter: ContextMeterService,
    @Inject(SDK_CATALOG) private readonly catalog: SdkCatalogAccessor,
    @Inject(SDK_CHAT_STREAM) private readonly sdkStream: SdkChatStreamFn,
  ) {}

  onModuleInit(): void {
    this.cachedGuessProvider = this.deriveGuessProvider();
    this.logger.log(
      `ChatGateway ready — WS path=${WS_PATH}, guessProvider=${this.cachedGuessProvider ?? '<none>'}`,
    );
  }

  /**
   * Resolve the gateway's pre-flight provider guess: the first configured
   * adapter from the router's PROVIDER_ORDER head (or `mock` when
   * MOCK_PROVIDER=true and no real adapter is configured). Reads from the
   * SDK catalog accessor so tests can override the answer via the
   * SDK_CATALOG token without touching env.
   */
  private deriveGuessProvider(): string | null {
    const order = parseProviderOrder(process.env.PROVIDER_ORDER) ?? [
      'openai',
      'anthropic',
      'gemini',
    ];
    const configured = this.catalog.listConfiguredProviders();
    if (configured.length === 0) return null;
    // Set<string> rather than Set<ProviderName> so the `has(name)` lookup
    // accepts our `order` array (parsed from env as plain strings — they're
    // narrowed to the union at parse time but TS doesn't carry that across
    // the `Set.has` boundary without an explicit cast).
    const configuredNames = new Set<string>(configured.map((c) => c.provider));
    for (const name of order) {
      if (configuredNames.has(name)) return name;
    }
    // No real provider in the order matched the configured set. Fall back
    // to the first configured entry — typically mock when MOCK_PROVIDER=true.
    return configured[0]!.provider;
  }

  async handleConnection(client: ChatClient, req: IncomingMessage): Promise<void> {
    try {
      const userId = await resolveWsUser(req.headers, this.auth);
      if (!userId) {
        client.close(WS_POLICY_VIOLATION, 'unauthenticated');
        return;
      }
      client.data = { userId, orchestrators: new Map() };
      // Bind our own raw message handler. We bypass @SubscribeMessage because
      // @nestjs/platform-ws's default dispatcher expects { event, data } and
      // our wire contract uses a `type` discriminator (see @argus/contracts).
      client.on('message', (raw: RawData) => {
        void this.onClientMessage(client, raw);
      });
    } catch (err) {
      captureApiError({
        err,
        feature: 'chat',
        layer: 'gateway',
        extra: { stage: 'handleConnection' },
      });
      try {
        client.close(WS_INTERNAL_ERROR, 'connect failure');
      } catch {
        // ignore — socket may already be closed
      }
    }
  }

  private async onClientMessage(client: ChatClient, raw: RawData): Promise<void> {
    const data = client.data;
    if (!data) {
      client.close(WS_POLICY_VIOLATION, 'unauthenticated');
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString());
    } catch (err) {
      captureApiError({
        err,
        feature: 'chat',
        layer: 'gateway',
        extra: { stage: 'json-parse' },
      });
      return;
    }
    const parsed = WsFrameInboundSchema.safeParse(payload);
    if (!parsed.success) {
      captureApiError({
        err: new Error('invalid_frame'),
        feature: 'chat',
        layer: 'gateway',
        extra: { stage: 'schema-parse', issues: parsed.error.issues.map((i) => i.message).join(';') },
      });
      return;
    }
    const frame = parsed.data;
    await withWsScope(
      {
        feature: 'chat',
        event: 'frame',
        userId: data.userId,
        frameType: frame.type,
      },
      async () => {
        if (frame.type === 'send') {
          await this.handleSend(client, data, frame);
        } else if (frame.type === 'cancel') {
          await this.handleCancel(data, frame.messageId);
        }
      },
    );
  }

  async handleDisconnect(client: ChatClient): Promise<void> {
    const data = client.data;
    if (!data) return;
    await withWsScope(
      { feature: 'chat', event: 'disconnect', userId: data.userId },
      async () => {
        for (const [messageId, orch] of data.orchestrators) {
          try {
            await orch.onDisconnect();
          } catch (err) {
            captureApiError({
              err,
              feature: 'chat',
              layer: 'gateway',
              extra: { stage: 'onDisconnect', messageId },
            });
          }
          this.seqRegistry.release(messageId);
        }
        data.orchestrators.clear();
      },
    );
  }

  private async handleSend(
    client: ChatClient,
    data: ChatClientData,
    frame: {
      type: 'send';
      conversationId: string | null;
      content: string;
      // chat-context-and-ux-polish (integration review — first-turn pin race).
      // Optional pin carried on the send frame so the FIRST turn of a brand-new
      // conversation honors the picker selection. Coupled at the contract
      // boundary (WsSendFrameSchema): both present or both omitted.
      pinnedProvider?: string;
      pinnedModel?: string;
    },
  ): Promise<void> {
    // Mint the assistant messageId BEFORE any work that can fail — the
    // frontend correlates `error` / `end` frames to its `send` frame by
    // messageId, so a sentinel UUID on the failure path (which the previous
    // implementation used) breaks the correlation entirely. The id we mint
    // here is the same one we'll later pass into startTurn so the happy path
    // is end-to-end consistent.
    const assistantMessageId = this.chatService.mintMessageId();

    // chat-context-and-ux-polish (integration review — first-turn pin race).
    // A send-frame pin is validated against the LIVE catalog BEFORE any write
    // (no conversation/message rows on a rejection) — the SAME validation the
    // PATCH handler uses (listConfiguredProviders). An invalid pin emits the
    // error+end terminal with `invalid_pin` and never starts the turn. The
    // contract already guarantees both fields move together, so a present
    // provider implies a present model.
    let sendPin: { provider: string; model: string } | undefined;
    if (frame.pinnedProvider && frame.pinnedModel) {
      const live = this.catalog.listConfiguredProviders();
      const ok = live.some(
        (e) => e.provider === frame.pinnedProvider && e.model === frame.pinnedModel,
      );
      if (!ok) {
        captureApiError({
          err: new Error('invalid_pin'),
          feature: 'chat',
          layer: 'gateway',
          statusClass: '4xx',
          extra: {
            stage: 'send-pin-validate',
            pinnedProvider: frame.pinnedProvider,
            pinnedModel: frame.pinnedModel,
          },
        });
        this.emitFailureTerminal(
          client,
          assistantMessageId,
          'invalid_pin',
          `pin (${frame.pinnedProvider}, ${frame.pinnedModel}) is not in the live catalog`,
        );
        return;
      }
      sendPin = { provider: frame.pinnedProvider, model: frame.pinnedModel };
    }

    // If conversationId is null this is the FIRST turn of a brand-new
    // conversation — mint a conversation row right here so subsequent frames
    // (and the web client's router.replace) have a stable id.
    let conversationId: string;
    if (frame.conversationId === null) {
      try {
        const created = await this.conversations.create(data.userId, defaultTitleFor(frame.content));
        conversationId = created.id;
      } catch (err) {
        captureApiError({
          err,
          feature: 'chat',
          layer: 'gateway',
          extra: { stage: 'createConversation' },
        });
        this.emitFailureTerminal(client, assistantMessageId, 'internal_error', 'Failed to create conversation');
        return;
      }
    } else {
      // Ownership check — never trust the conversationId from the client.
      const conv = await this.conversations.getByIdForUser(frame.conversationId, data.userId);
      if (!conv) {
        this.emitFailureTerminal(client, assistantMessageId, 'not_found', 'Conversation not found');
        return;
      }
      conversationId = frame.conversationId;
    }

    // chat-context-and-ux-polish LLD Task 53 — startTurn now returns the
    // multi-turn history (oldest-first, streaming rows excluded) AND the
    // conversation's pin pair, so the gateway can build the SDK request
    // without a second round-trip.
    let startResult;
    try {
      startResult = await this.chatService.startTurn({
        userId: data.userId,
        conversationId,
        userMessageContent: frame.content,
        // Pre-minted id flows through startTurn so the WS error/end frames
        // emitted here correlate to the message row that startTurn would have
        // written on success.
        assistantMessageId,
        // chat-context-and-ux-polish (integration review — first-turn pin
        // race). When the send frame carried a (validated) pin, persist it
        // onto the conversation row INSIDE the startTurn transaction so it's
        // atomic with the message inserts and respects the same userId
        // ownership scoping. Turn 2+ then read it via the persisted-pin path.
        ...(sendPin ? { pin: sendPin } : {}),
      });
    } catch (err) {
      captureApiError({
        err,
        feature: 'chat',
        layer: 'gateway',
        extra: { stage: 'startTurn', conversationId, messageId: assistantMessageId },
      });
      this.emitFailureTerminal(client, assistantMessageId, 'internal_error', 'Failed to start turn');
      return;
    }

    const abort = new AbortController();
    const turnIndex = await this.computeTurnIndex(conversationId);
    // chat-context-and-ux-polish LLD Tasks 61/63/65 — build the SDK
    // request with pin (when both columns set), effective budget +
    // context window cap (catalog-derived), and the cached guess.
    //
    // Precedence (integration review — first-turn pin race): an explicit pin
    // on the send frame wins over the conversation's persisted pin for THIS
    // turn. `sendPin` was already validated against the live catalog and
    // persisted inside the startTurn transaction above, so the persisted-pin
    // read would already reflect it — but we resolve `sendPin` first
    // explicitly so the precedence is obvious and independent of read timing.
    const pin =
      sendPin ??
      (startResult.pinnedProvider && startResult.pinnedModel
        ? { provider: startResult.pinnedProvider, model: startResult.pinnedModel }
        : undefined);
    const configuredDefault = defaultContextBudget();
    const effectiveBudget = this.catalog.getEffectiveBudget(configuredDefault, pin);
    // Window cap is the pinned model's contextWindow (or absent when no pin
    // / unknown pin). When absent the gateway omits the hint so the span
    // attr `llm.context_window_cap` simply isn't set rather than stamped
    // with a misleading zero.
    let contextWindowCap: number | undefined;
    if (pin) {
      const entry = this.catalog.getCatalogEntry(pin.provider, pin.model);
      if (entry) contextWindowCap = entry.contextWindow;
    }
    const sdkRequest: ChatStreamRequest = {
      // LLD Task 53: thread the full history (already includes the just-
      // inserted user message). Streaming rows were excluded server-side.
      messages: startResult.history ?? [{ role: 'user', content: frame.content }],
      conversationId,
      turnIndex,
      userId: data.userId,
      messageId: assistantMessageId,
      signal: abort.signal,
      ...(pin ? { pin } : {}),
      effectiveBudget,
      ...(contextWindowCap !== undefined ? { contextWindowCap } : {}),
      ...(this.cachedGuessProvider !== null
        ? { guessProvider: this.cachedGuessProvider }
        : {}),
    };
    const sdkStream = this.sdkStream(sdkRequest);

    // chat-context-and-ux-polish LLD Task 67 — the legacy mock/mock-1 literals
    // are gone. The SDK's `commit` chunk (LLD Preamble §1) is what the
    // orchestrator turns into the WS `metadata` frame; no gateway-side guess.
    const orchestrator = new StreamOrchestrator(this.chatService, this.seqRegistry, {
      messageId: assistantMessageId,
      conversationId,
      // LLD Task 57 — pass the meter + userId so the orchestrator can
      // populate the `end` frame's tokensUsed/tokensBudget on the complete
      // terminal.
      userId: data.userId,
      meter: this.contextMeter,
      sdkStream,
      abort,
      emit: (out) => this.send(client, out),
    });
    data.orchestrators.set(assistantMessageId, orchestrator);

    // Fire-and-forget; the orchestrator handles its own errors.
    void orchestrator.runStream().finally(() => {
      data.orchestrators.delete(assistantMessageId);
    });
  }

  private async handleCancel(data: ChatClientData, messageId: string): Promise<void> {
    const orch = data.orchestrators.get(messageId);
    if (!orch) {
      // No active stream for that messageId. Could be late cancel — silent
      // no-op (the client should already be seeing the end frame).
      return;
    }
    try {
      await orch.cancel();
    } catch (err) {
      captureApiError({
        err,
        feature: 'chat',
        layer: 'gateway',
        extra: { stage: 'cancel', messageId },
      });
    }
  }

  /**
   * Turn index for the conversation — used by the SDK for context windowing.
   * We approximate as the count of existing assistant messages; the real
   * SDK may compute this differently when context building lands.
   */
  private async computeTurnIndex(_conversationId: string): Promise<number> {
    // Stubbed for Phase A — the mock SDK ignores turnIndex. The real SDK
    // will need a more careful count; that's its LLD's problem.
    return 0;
  }

  private send(client: ChatClient, frame: WsFrameOutbound): void {
    if (client.readyState !== 1 /* OPEN */) return;
    try {
      client.send(JSON.stringify(frame));
    } catch (err) {
      captureApiError({
        err,
        feature: 'chat',
        layer: 'gateway',
        extra: { stage: 'send', frameType: frame.type },
      });
    }
  }

  /**
   * Centralized terminal-error emission for pre-orchestrator failures.
   *
   * Per LLD Tasks 53/54: every terminal must be `error` followed by `end`
   * with `status='failed'`, sharing the same messageId so the web client can
   * correlate against its outgoing `send` frame. Pre-orchestrator paths
   * (conversation create failure, ownership reject, startTurn failure) all
   * funnel through here so the contract is enforced in exactly one place.
   *
   * The `end` frame uses a synthesized seq (1) since no `start` frame was
   * emitted — the web client treats the {error,end} pair as a fully-formed
   * terminal and never expects token frames for this messageId.
   */
  private emitFailureTerminal(
    client: ChatClient,
    messageId: string,
    errorCode: string,
    message: string,
  ): void {
    this.send(client, buildErrorFrame(messageId, errorCode, message));
    this.send(client, buildEndFrame(messageId, 1, 'failed'));
  }
}

/**
 * Derive a fallback title for a brand-new conversation from the first
 * user message. The web client can rename it later via PATCH; this avoids
 * an empty-title row in the sidebar.
 */
function defaultTitleFor(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  return trimmed.length <= 60 ? trimmed : trimmed.slice(0, 57) + '...';
}

/**
 * Parse PROVIDER_ORDER env into the canonical name list. Mirrors the
 * router's `envOrder()` so the gateway's pre-flight guess follows the same
 * priority head the router uses for failover. Returns undefined on missing
 * or empty env so the caller can apply its own default.
 */
function parseProviderOrder(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => s.trim().toLowerCase());
  const valid: string[] = [];
  for (const p of parts) {
    if (p === 'openai' || p === 'anthropic' || p === 'gemini' || p === 'mock') {
      valid.push(p);
    }
  }
  return valid.length > 0 ? valid : undefined;
}
