// Tasks 12, 14, 16: ProjectionService end-to-end integration tests.
//
// Boots an ephemeral Postgres via testcontainers, applies the migration,
// seeds rows manually, then exercises ProjectionService.handle(span).
//
// Skips cleanly when Docker is not available locally (loud SKIP message).
// CI MUST have docker; if the suite is skipped in CI that's a config bug.
import { randomUUID } from 'node:crypto';
import {
  OTEL_ATTRS,
  LLM_KIND,
  LLM_SAMPLE_WORKSPACE_ID,
  SPAN_EVENT_NAMES,
  type OtlpSpan,
} from '@argus/contracts';
import { ProjectionService } from '../src/projection/projection.service';
import type { LiveEventsPublisher } from '../src/projection/live-events-publisher';
import {
  bootIntegrationEnv,
  dockerAvailable,
  tearDownIntegrationEnv,
  type IntegrationEnv,
} from './helpers/integration-env';

const describeIntegration = dockerAvailable() ? describe : describe.skip;

if (!dockerAvailable()) {
  // eslint-disable-next-line no-console
  console.warn(
    '[projection.service.integration] SKIPPED: docker unavailable. CI must run this suite.',
  );
}

describeIntegration('ProjectionService.handle (integration)', () => {
  let env: IntegrationEnv;
  let service: ProjectionService;
  // Publisher stub — the post-commit live-events publish is exercised via this
  // spy so the integration tests can assert call count / ordering without a
  // real kafka broker.
  let publishSpy: jest.Mock;

  beforeAll(async () => {
    env = await bootIntegrationEnv();
    publishSpy = jest.fn().mockResolvedValue(undefined);
    const publisher = { publish: publishSpy } as unknown as LiveEventsPublisher;
    service = new ProjectionService(env.prisma, publisher);
  }, 120_000);

  beforeEach(() => {
    publishSpy.mockClear();
    publishSpy.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    if (env) await tearDownIntegrationEnv(env);
  }, 30_000);

  async function seedUserAndConversation(): Promise<{
    userId: string;
    conversationId: string;
  }> {
    const userId = randomUUID();
    const conversationId = randomUUID();
    await env.prisma.user.create({
      data: {
        id: userId,
        email: `u-${userId}@test.local`,
        passwordHash: 'x',
      },
    });
    await env.prisma.conversation.create({
      data: {
        id: conversationId,
        userId,
        title: 't',
      },
    });
    return { userId, conversationId };
  }

  async function seedPlaceholderInference(args: {
    messageId: string;
    userId: string;
    conversationId: string;
    provider: string;
    status: 'streaming' | 'failed';
    // Phase B identity columns — set by the API gateway's startTurn in
    // production. Optional here; omitted → a plain chat placeholder (DB default
    // kind=chat, null FKs).
    kind?: 'chat' | 'replay' | 'sample' | 'classifier' | 'heartbeat';
    sampleWorkspaceId?: string;
    replayOfInferenceId?: string;
  }): Promise<string> {
    const id = randomUUID();
    await env.prisma.inference.create({
      data: {
        id,
        messageId: args.messageId,
        conversationId: args.conversationId,
        userId: args.userId,
        provider: args.provider,
        model: 'gpt-4o-mini',
        status: args.status,
        startedAt: new Date(),
        ...(args.kind ? { kind: args.kind } : {}),
        ...(args.sampleWorkspaceId ? { sampleWorkspaceId: args.sampleWorkspaceId } : {}),
        ...(args.replayOfInferenceId ? { replayOfInferenceId: args.replayOfInferenceId } : {}),
      },
    });
    return id;
  }

  function makeSpan(args: {
    messageId: string;
    conversationId: string;
    userId: string;
    provider?: string;
    status?: 'ok' | 'failed';
    traceId?: string;
    spanId?: string;
    startMs?: number;
    // Phase B control-plane attributes (llm.kind + FK attrs). Merged into the
    // attribute map so the consumer's preserve-raw-attributes path is exercised.
    phaseB?: Record<string, unknown>;
  }): OtlpSpan {
    const startMs = args.startMs ?? Date.now();
    return {
      traceId: args.traceId ?? 'trace-' + randomUUID(),
      spanId: args.spanId ?? 'span-' + randomUUID(),
      name: 'llm.chat.stream',
      startTimeUnixNano: String(startMs * 1_000_000),
      endTimeUnixNano: String((startMs + 800) * 1_000_000),
      attributes: {
        [OTEL_ATTRS.LLM_PROVIDER]: args.provider ?? 'openai',
        [OTEL_ATTRS.LLM_MODEL]: 'gpt-4o-mini',
        [OTEL_ATTRS.LLM_PROMPT_TOKENS]: 100,
        [OTEL_ATTRS.LLM_COMPLETION_TOKENS]: 50,
        [OTEL_ATTRS.LLM_STATUS]: args.status ?? 'ok',
        [OTEL_ATTRS.LLM_PROMPT_COST_USD_MICROS]: 1500,
        [OTEL_ATTRS.LLM_COMPLETION_COST_USD_MICROS]: 1000,
        [OTEL_ATTRS.LLM_INPUT_PREVIEW]: 'hi',
        [OTEL_ATTRS.LLM_OUTPUT_PREVIEW]: 'hey',
        [OTEL_ATTRS.CONVERSATION_ID]: args.conversationId,
        [OTEL_ATTRS.USER_ID]: args.userId,
        [OTEL_ATTRS.MESSAGE_ID]: args.messageId,
        [OTEL_ATTRS.TURN_INDEX]: 0,
        ...(args.phaseB ?? {}),
      } as unknown as OtlpSpan['attributes'],
      events: [
        {
          name: SPAN_EVENT_NAMES.LLM_INPUT,
          body: { messages: [{ role: 'user', content: 'hi' }] },
        },
        {
          name: SPAN_EVENT_NAMES.LLM_OUTPUT,
          body: { content: 'hey' },
        },
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Task 12: single-span happy path enriches placeholder, never touches messages.
  // -------------------------------------------------------------------------
  // RESOLVED (Phase B merge): the trace_events unique-index collision is fixed
  // by migration 0003_phase_b_kind_enum, which widens the unique from
  // (trace_id, span_id) to (trace_id, span_id, name). A span's llm.input +
  // llm.output events now persist as distinct rows; redeliveries still collide
  // on their first event. Un-skipped now that the migration lands via merge.
  it('enriches the existing inferences placeholder by message_id; does not touch messages', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const messageId = randomUUID();
    const inferenceId = await seedPlaceholderInference({
      messageId,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
    });
    // No row in `messages` is created — the test verifies the consumer does
    // not write that table even when the row is absent.

    const span = makeSpan({ messageId, conversationId, userId, provider: 'openai' });
    await service.handle(span);

    const enriched = await env.prisma.inference.findUnique({ where: { id: inferenceId } });
    expect(enriched).not.toBeNull();
    expect(enriched?.promptTokens).toBe(100);
    expect(enriched?.completionTokens).toBe(50);
    expect(enriched?.promptCostUsdMicros).toBe(1500);
    expect(enriched?.completionCostUsdMicros).toBe(1000);
    expect(enriched?.traceId).toBe(span.traceId);
    expect(enriched?.spanId).toBe(span.spanId);
    expect(enriched?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(enriched?.status).toBe('ok');

    const traceEvents = await env.prisma.traceEvent.findMany({
      where: { traceId: span.traceId, spanId: span.spanId },
    });
    expect(traceEvents).toHaveLength(2);

    // CRITICAL ownership-boundary assertion: messages table is untouched.
    const messageRows = await env.prisma.message.findMany({ where: { id: messageId } });
    expect(messageRows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Task 14: duplicate delivery is a no-op.
  // -------------------------------------------------------------------------
  // RESOLVED (Phase B merge): see the note on the first un-skipped test. The
  // widened (trace_id, span_id, name) unique now lets 2 trace_events persist
  // per span, so this idempotency assertion holds.
  it('is idempotent under duplicate span delivery', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const messageId = randomUUID();
    const inferenceId = await seedPlaceholderInference({
      messageId,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
    });
    const span = makeSpan({ messageId, conversationId, userId, provider: 'openai' });

    await service.handle(span);
    const afterFirst = await env.prisma.inference.findUnique({
      where: { id: inferenceId },
    });

    // Re-deliver the same span. Should be a no-op: one trace_events row, and
    // the inference row should not get re-stomped (values from first apply).
    await service.handle(span);

    const traceEvents = await env.prisma.traceEvent.findMany({
      where: { traceId: span.traceId, spanId: span.spanId },
    });
    expect(traceEvents).toHaveLength(2); // 2 from first delivery, 0 from second.

    const afterSecond = await env.prisma.inference.findUnique({
      where: { id: inferenceId },
    });
    expect(afterSecond?.traceId).toBe(afterFirst?.traceId);
    expect(afterSecond?.spanId).toBe(afterFirst?.spanId);
    expect(afterSecond?.promptTokens).toBe(afterFirst?.promptTokens);
  });

  // -------------------------------------------------------------------------
  // Task 16: failover attempt creates a new row, keeps the failed one.
  // -------------------------------------------------------------------------
  it('inserts a new inferences row on failover (different provider, prior row failed)', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const messageId = randomUUID();
    const failedRowId = await seedPlaceholderInference({
      messageId,
      userId,
      conversationId,
      provider: 'openai',
      status: 'failed',
    });

    const span = makeSpan({
      messageId,
      conversationId,
      userId,
      provider: 'anthropic',
      status: 'ok',
    });
    await service.handle(span);

    const rows = await env.prisma.inference.findMany({
      where: { messageId },
      orderBy: { startedAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    const failed = rows.find((r) => r.id === failedRowId);
    const succeeded = rows.find((r) => r.id !== failedRowId);
    expect(failed?.provider).toBe('openai');
    expect(failed?.status).toBe('failed');
    expect(succeeded?.provider).toBe('anthropic');
    expect(succeeded?.status).toBe('ok');
    expect(succeeded?.userId).toBe(userId);
    expect(succeeded?.conversationId).toBe(conversationId);
    expect(succeeded?.messageId).toBe(messageId);
  });

  // -------------------------------------------------------------------------
  // Crash-safety: if the trace_events insert succeeded on the first delivery
  // but the inference write didn't happen, a redelivery MUST short-circuit
  // on the trace_events unique index (P2002) and leave the inferences row
  // in whatever state it was. Verifies the inverted-ordering invariant.
  // -------------------------------------------------------------------------
  // RESOLVED (Phase B merge): see the note on the first un-skipped test.
  // Depends on multiple trace_events per span persisting, which the widened
  // (trace_id, span_id, name) unique now allows.
  it('redelivery short-circuits on trace_events P2002 even when inferences row is un-enriched', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const messageId = randomUUID();
    const inferenceId = await seedPlaceholderInference({
      messageId,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
    });
    const span = makeSpan({ messageId, conversationId, userId, provider: 'openai' });

    // Simulate "crashed after trace_events insert, before inference write":
    // manually insert both trace_events rows under the same (trace_id, span_id)
    // the consumer would use, then immediately redeliver the span.
    for (const evt of span.events) {
      await env.prisma.traceEvent.create({
        data: {
          traceId: span.traceId,
          spanId: span.spanId,
          messageId,
          userId,
          name: evt.name,
          payload: (evt.body ?? null) as object,
          truncated: false,
        },
      });
    }
    // Capture the un-enriched inference row state.
    const beforeRedelivery = await env.prisma.inference.findUnique({
      where: { id: inferenceId },
    });
    expect(beforeRedelivery?.promptTokens).toBeNull();
    expect(beforeRedelivery?.traceId).toBeNull();

    // Redeliver. The handler should P2002 on the first trace_events insert
    // and return early — NOT enrich the inference, NOT crash, NOT duplicate
    // trace_events rows.
    await service.handle(span);

    const events = await env.prisma.traceEvent.findMany({
      where: { traceId: span.traceId, spanId: span.spanId },
    });
    expect(events).toHaveLength(2); // unchanged

    const afterRedelivery = await env.prisma.inference.findUnique({
      where: { id: inferenceId },
    });
    // Inference row stays un-enriched. Acceptable degradation per the
    // crash-safety doc in projection.service.ts header: trace_events is the
    // load-bearing record for Phase B Replay.
    expect(afterRedelivery?.promptTokens).toBeNull();
    expect(afterRedelivery?.traceId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // REVIEW-BRIEF Finding 1: previews are derived from span body events when the
  // producer omits llm.input_preview / llm.output_preview attributes.
  //
  // On the real wire the body string rides as event.attributes.body (not
  // event.body). The input body is JSON {"messages":[…]}; the output body is
  // the assistant text verbatim. The mapper must extract the last user message
  // as input_preview and the raw string as output_preview.
  // -------------------------------------------------------------------------
  it('derives input_preview and output_preview from span body events when preview attributes are absent', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const messageId = randomUUID();
    const inferenceId = await seedPlaceholderInference({
      messageId,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
    });

    const startMs = Date.now();
    // Build a span that deliberately omits llm.input_preview / llm.output_preview
    // and carries the body as event.attributes.body — the real-wire shape.
    const span: OtlpSpan = {
      traceId: 'trace-' + randomUUID(),
      spanId: 'span-' + randomUUID(),
      name: 'llm.chat.stream',
      startTimeUnixNano: String(startMs * 1_000_000),
      endTimeUnixNano: String((startMs + 800) * 1_000_000),
      attributes: {
        [OTEL_ATTRS.LLM_PROVIDER]: 'openai',
        [OTEL_ATTRS.LLM_MODEL]: 'gpt-4o-mini',
        [OTEL_ATTRS.LLM_PROMPT_TOKENS]: 120,
        [OTEL_ATTRS.LLM_COMPLETION_TOKENS]: 12,
        [OTEL_ATTRS.LLM_STATUS]: 'ok',
        [OTEL_ATTRS.LLM_PROMPT_COST_USD_MICROS]: 1800,
        [OTEL_ATTRS.LLM_COMPLETION_COST_USD_MICROS]: 240,
        // No LLM_INPUT_PREVIEW — not set by the producer.
        // No LLM_OUTPUT_PREVIEW — not set by the producer.
        [OTEL_ATTRS.CONVERSATION_ID]: conversationId,
        [OTEL_ATTRS.USER_ID]: userId,
        [OTEL_ATTRS.MESSAGE_ID]: messageId,
        [OTEL_ATTRS.TURN_INDEX]: 0,
      } as unknown as OtlpSpan['attributes'],
      events: [
        {
          name: SPAN_EVENT_NAMES.LLM_INPUT,
          // Real-wire shape: body string is nested under attributes.body
          attributes: {
            body: JSON.stringify({
              messages: [
                { role: 'system', content: 'You are a helpful geography assistant.' },
                { role: 'user', content: 'what is the capital of France?' },
              ],
            }),
            truncated: false,
          },
        },
        {
          name: SPAN_EVENT_NAMES.LLM_OUTPUT,
          // Real-wire shape: output body is the assistant text verbatim
          attributes: {
            body: 'The capital of France is Paris.',
            truncated: false,
          },
        },
      ],
    };

    await service.handle(span);

    const enriched = await env.prisma.inference.findUnique({ where: { id: inferenceId } });
    expect(enriched).not.toBeNull();
    // Core Finding 1 assertions: both columns must be non-null and human-readable.
    expect(enriched?.inputPreview).toBe('what is the capital of France?');
    expect(enriched?.outputPreview).toBe('The capital of France is Paris.');
    // Sanity: other numeric columns were still written.
    expect(enriched?.promptTokens).toBe(120);
    expect(enriched?.completionTokens).toBe(12);
    expect(enriched?.status).toBe('ok');
  });

  // -------------------------------------------------------------------------
  // Belt-and-braces: source code does not import the messages Prisma delegate.
  // -------------------------------------------------------------------------
  it('ProjectionService source code never references prisma.message (ownership boundary lint)', () => {
    // Lightweight static assertion — read the file and grep.
    // Heavier than a real lint rule but immediate and fail-loud.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const raw = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'projection', 'projection.service.ts'),
      'utf8',
    );
    // Strip comments before grepping — the file's own header documents the
    // ownership rule with the literal `prisma.message`, which is not a usage.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(src).not.toMatch(/prisma\.message\b/);
    expect(src).not.toMatch(/\.message\.update\b/);
    expect(src).not.toMatch(/\.message\.create\b/);
  });

  // -------------------------------------------------------------------------
  // Task 29/30: clear-fence drops a span ahead of the fence — no rows, no publish.
  // -------------------------------------------------------------------------
  it('drops a span (no trace_events, no inference, no publish) when the fence is ahead of startedAt', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const messageId = randomUUID();
    await env.prisma.userClearFence.create({
      data: { userId, clearAfterTs: new Date(Date.now() + 3_600_000) },
    });
    // Span started a minute ago — well before the fence.
    const span = makeSpan({ messageId, conversationId, userId, startMs: Date.now() - 60_000 });
    await service.handle(span);

    expect(await env.prisma.inference.count({ where: { messageId } })).toBe(0);
    expect(
      await env.prisma.traceEvent.count({
        where: { traceId: span.traceId, spanId: span.spanId },
      }),
    ).toBe(0);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Task 31(a): publish fires AFTER the commit, exactly once, snake_case payload.
  // -------------------------------------------------------------------------
  it('publishes exactly once on a fresh span, after the inference row is committed', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const messageId = randomUUID();
    await seedPlaceholderInference({
      messageId,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
    });
    // Observe commit ordering: when publish fires, the enriched row must be
    // visible (committed) already.
    let visibleAtPublish = -1;
    publishSpy.mockImplementation(async () => {
      visibleAtPublish = await env.prisma.inference.count({
        where: { messageId, status: 'ok' },
      });
    });

    const span = makeSpan({ messageId, conversationId, userId });
    await service.handle(span);

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(visibleAtPublish).toBe(1);
    expect(publishSpy.mock.calls[0]![0]).toEqual({
      user_id: userId,
      kind: 'chat',
      conversation_id: conversationId,
    });
  });

  // -------------------------------------------------------------------------
  // Task 31(b): a DB transaction failure means NO publish (the tick would lie).
  // -------------------------------------------------------------------------
  it('never publishes when the DB transaction throws', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const messageId = randomUUID();
    await seedPlaceholderInference({
      messageId,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
    });
    const txSpy = jest
      .spyOn(env.prisma, '$transaction')
      .mockRejectedValueOnce(new Error('db down') as never);
    const span = makeSpan({ messageId, conversationId, userId });

    await expect(service.handle(span)).rejects.toThrow('db down');
    expect(publishSpy).not.toHaveBeenCalled();
    txSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Task 31(c): a duplicate redelivery publishes ONCE (not per delivery).
  // -------------------------------------------------------------------------
  it('publishes exactly once across a duplicate redelivery', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const messageId = randomUUID();
    await seedPlaceholderInference({
      messageId,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
    });
    const span = makeSpan({ messageId, conversationId, userId });

    await service.handle(span);
    await service.handle(span); // redelivery: identical (trace_id, span_id, name)

    expect(await env.prisma.inference.count({ where: { messageId } })).toBe(1);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Task 34: clear-fence proceed (past fence) and no-fence branches both
  // persist and publish exactly once each.
  // -------------------------------------------------------------------------
  it('clear-fence proceed and no-fence branches both persist and publish exactly once', async () => {
    const a = await seedUserAndConversation();
    await env.prisma.userClearFence.create({
      data: { userId: a.userId, clearAfterTs: new Date(Date.now() - 3_600_000) },
    });
    const b = await seedUserAndConversation();
    const msgA = randomUUID();
    const msgB = randomUUID();
    await seedPlaceholderInference({
      messageId: msgA,
      userId: a.userId,
      conversationId: a.conversationId,
      provider: 'openai',
      status: 'streaming',
    });
    await seedPlaceholderInference({
      messageId: msgB,
      userId: b.userId,
      conversationId: b.conversationId,
      provider: 'openai',
      status: 'streaming',
    });
    const spanA = makeSpan({ messageId: msgA, conversationId: a.conversationId, userId: a.userId });
    const spanB = makeSpan({ messageId: msgB, conversationId: b.conversationId, userId: b.userId });

    await service.handle(spanA);
    await service.handle(spanB);

    expect(await env.prisma.inference.count({ where: { messageId: msgA } })).toBe(1);
    expect(await env.prisma.inference.count({ where: { messageId: msgB } })).toBe(1);
    expect(
      await env.prisma.traceEvent.count({ where: { traceId: spanA.traceId, spanId: spanA.spanId } }),
    ).toBe(2);
    expect(
      await env.prisma.traceEvent.count({ where: { traceId: spanB.traceId, spanId: spanB.spanId } }),
    ).toBe(2);
    expect(publishSpy).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Task 35 [updated for the projection-clobber fix]: the Phase B identity
  // columns (kind + control-plane FKs) are owned by the gateway's startTurn
  // placeholder. update-in-place PRESERVES them and must NOT overwrite them
  // from the span — while still enriching telemetry on the same write.
  // (HLD D5 "no parallel write code" holds: one path, identity gateway-owned.)
  // -------------------------------------------------------------------------
  it('preserves the gateway-set Phase B identity columns on update-in-place (sample kind+FK)', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const ws = await env.prisma.sampleWorkspace.create({ data: { userId } });

    // Gateway created the placeholder as a sample inference (kind + FK set).
    const sampleMsg = randomUUID();
    await seedPlaceholderInference({
      messageId: sampleMsg,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
      kind: 'sample',
      sampleWorkspaceId: ws.id,
    });
    // Span enriches telemetry. Even when it ALSO carries llm.kind=sample, the
    // identity is the placeholder's — not re-derived from the span.
    await service.handle(
      makeSpan({
        messageId: sampleMsg,
        conversationId,
        userId,
        phaseB: { [LLM_KIND]: 'sample', [LLM_SAMPLE_WORKSPACE_ID]: ws.id },
      }),
    );
    const sampleRow = await env.prisma.inference.findFirst({ where: { messageId: sampleMsg } });
    expect(sampleRow?.kind).toBe('sample');
    expect(sampleRow?.sampleWorkspaceId).toBe(ws.id);
    // Telemetry WAS enriched on the same update.
    expect(sampleRow?.promptTokens).toBe(100);
    expect(sampleRow?.status).toBe('ok');

    // A chat placeholder + chat span stays kind=chat with a null FK.
    const chatMsg = randomUUID();
    await seedPlaceholderInference({
      messageId: chatMsg,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
    });
    await service.handle(makeSpan({ messageId: chatMsg, conversationId, userId }));
    const chatRow = await env.prisma.inference.findFirst({ where: { messageId: chatMsg } });
    expect(chatRow?.kind).toBe('chat');
    expect(chatRow?.sampleWorkspaceId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // [regression] Projection-clobber fix (the live bug, 2026-05-26): a replay
  // placeholder (kind=replay + replayOfInferenceId, set by startTurn) reuses
  // the chat SDK path, so its span carries NO llm.kind / llm.replay_of_inference_id.
  // update-in-place must enrich telemetry WITHOUT resetting kind->chat or
  // nulling the replay FK — otherwise computeReplayDiff returns not_a_replay_row
  // and the Replay diff never surfaces (it raced the UI poll).
  // -------------------------------------------------------------------------
  it('preserves kind=replay + replayOfInferenceId on update-in-place when the span omits Phase B attrs', async () => {
    const { userId, conversationId } = await seedUserAndConversation();

    // The source (original) inference the replay points back to.
    const sourceMsg = randomUUID();
    const sourceInferenceId = await seedPlaceholderInference({
      messageId: sourceMsg,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
    });

    // The replay placeholder, exactly as startTurn creates it.
    const replayMsg = randomUUID();
    const replayInferenceId = await seedPlaceholderInference({
      messageId: replayMsg,
      userId,
      conversationId,
      provider: 'openai',
      status: 'streaming',
      kind: 'replay',
      replayOfInferenceId: sourceInferenceId,
    });

    // The replay's span — produced by the shared chat SDK path — carries NO
    // llm.kind and NO llm.replay_of_inference_id (the real-wire shape that
    // triggered the clobber).
    await service.handle(makeSpan({ messageId: replayMsg, conversationId, userId }));

    const row = await env.prisma.inference.findUnique({ where: { id: replayInferenceId } });
    // Identity preserved (the fix):
    expect(row?.kind).toBe('replay');
    expect(row?.replayOfInferenceId).toBe(sourceInferenceId);
    // Telemetry still enriched on the same update:
    expect(row?.promptTokens).toBe(100);
    expect(row?.completionTokens).toBe(50);
    expect(row?.status).toBe('ok');
    expect(row?.traceId).not.toBeNull();

    // The live-events tick must label the replay by its gateway-owned kind, not
    // the span-derived 'chat' default (the cosmetic live-feed mislabel).
    expect(publishSpy).toHaveBeenCalledWith({
      user_id: userId,
      kind: 'replay',
      conversation_id: conversationId,
    });
  });

  // -------------------------------------------------------------------------
  // Task 37 [regression]: heartbeat burst with duplicate redeliveries. Row and
  // publish counts match the unique-span count, NOT the total invocation count.
  // (Models the api heartbeat emitter carrying >=1 span event so the
  // (trace_id, span_id, name) dedup gate applies — per the Codex review note.)
  // -------------------------------------------------------------------------
  it('heartbeat idempotency burst: rows + publishes match the unique-span count', async () => {
    const { userId, conversationId } = await seedUserAndConversation();
    const BURST = 6;
    const spans = Array.from({ length: BURST }, () =>
      makeSpan({
        messageId: randomUUID(),
        conversationId,
        userId,
        phaseB: { [LLM_KIND]: 'heartbeat' },
      }),
    );
    for (const s of spans) await service.handle(s);
    // Redeliver half — identical tuples collide on the first event (P2002).
    for (const s of spans.slice(0, BURST / 2)) await service.handle(s);

    expect(await env.prisma.inference.count({ where: { userId, kind: 'heartbeat' } })).toBe(BURST);
    // Each span carries 2 events (llm.input + llm.output) -> 2 trace_events/span.
    expect(await env.prisma.traceEvent.count({ where: { userId, kind: 'heartbeat' } })).toBe(
      BURST * 2,
    );
    expect(publishSpy).toHaveBeenCalledTimes(BURST);
  });
});
