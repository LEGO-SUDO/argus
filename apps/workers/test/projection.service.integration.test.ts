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
  SPAN_EVENT_NAMES,
  type OtlpSpan,
} from '@argus/contracts';
import { ProjectionService } from '../src/projection/projection.service';
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

  beforeAll(async () => {
    env = await bootIntegrationEnv();
    service = new ProjectionService(env.prisma);
  }, 120_000);

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
  }): OtlpSpan {
    const startMs = Date.now();
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
      },
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
  // Belt-and-braces: source code does not import the messages Prisma delegate.
  // -------------------------------------------------------------------------
  it('ProjectionService source code never references prisma.message (ownership boundary lint)', () => {
    // Lightweight static assertion — read the file and grep.
    // Heavier than a real lint rule but immediate and fail-loud.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'projection', 'projection.service.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/prisma\.message\b/);
    expect(src).not.toMatch(/\.message\.update\b/);
    expect(src).not.toMatch(/\.message\.create\b/);
  });
});
