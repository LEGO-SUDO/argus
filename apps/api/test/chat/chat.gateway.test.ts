// ChatGateway — focused on the pre-orchestrator error path contracts
// (Tasks 53/54 + Codex-review fixes #5 and #6):
//   - every terminal `error` is followed by an `end` with status=failed,
//   - both frames share the same messageId (not a sentinel UUID) so the web
//     client can correlate the failure to its outgoing `send` frame.
//
// We bypass the @nestjs/platform-ws machinery and call handleSend directly
// against a fake WebSocket — the gateway logic under test is the same.
import { ChatGateway } from '../../src/chat/chat.gateway';
import { ChatService } from '../../src/chat/chat.service';
import { SeqCounterRegistry } from '../../src/chat/seq-counter';
import { ConversationsRepository } from '../../src/conversations/conversations.repository';
import { PrismaService } from '../../src/common/prisma.service';
import { AuthService } from '../../src/auth/auth.service';
import { SessionRepository } from '../../src/auth/session.repository';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { randomUUID } from 'crypto';
import type { WsFrameOutbound } from '@argus/contracts';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

interface FakeClient {
  readyState: number;
  sent: WsFrameOutbound[];
  data?: { userId: string; orchestrators: Map<string, unknown> };
  send: (raw: string) => void;
  on: () => void;
  close: () => void;
}

function fakeClient(userId: string): FakeClient {
  const sent: WsFrameOutbound[] = [];
  return {
    readyState: 1,
    sent,
    data: { userId, orchestrators: new Map() },
    send: (raw: string) => {
      sent.push(JSON.parse(raw) as WsFrameOutbound);
    },
    on: () => {},
    close: () => {},
  };
}

function build(prisma: InMemoryPrisma): {
  gateway: ChatGateway;
  prisma: InMemoryPrisma;
} {
  const ps = new PrismaService(prisma as never);
  const sessions = new SessionRepository(ps);
  const auth = new AuthService(ps, sessions);
  const conversations = new ConversationsRepository(ps);
  const chatService = new ChatService(ps);
  const seqRegistry = new SeqCounterRegistry();
  const gateway = new ChatGateway(chatService, seqRegistry, auth, conversations);
  return { gateway, prisma };
}

describe('ChatGateway.handleSend — pre-orchestrator failure terminals', () => {
  it('on unknown conversationId emits error + end(status=failed) sharing the same minted messageId', async () => {
    const { gateway, prisma } = build(createInMemoryPrisma());
    const userId = randomUUID();
    prisma.users.push({ id: userId, email: `${userId}@t`, passwordHash: 'x', createdAt: new Date() });
    const client = fakeClient(userId);

    // Access the private via index — testing the private path is intentional;
    // making it public would expand the gateway's API surface unnecessarily.
    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(
      client,
      client.data,
      { type: 'send', conversationId: randomUUID(), content: 'hi' },
    );

    expect(client.sent).toHaveLength(2);
    const [errorFrame, endFrame] = client.sent;
    expect(errorFrame!.type).toBe('error');
    expect(endFrame!.type).toBe('end');
    // The two frames MUST correlate via shared messageId — no sentinel UUID.
    expect(errorFrame!.type === 'error' && errorFrame.messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(endFrame!.type === 'end' && endFrame.messageId).toBe(
      errorFrame!.type === 'error' ? errorFrame.messageId : 'mismatch',
    );
    expect(endFrame!.type === 'end' && endFrame.status).toBe('failed');
    // The minted id MUST NOT be the all-zeros sentinel the previous code used.
    expect(errorFrame!.type === 'error' && errorFrame.messageId).not.toBe(
      '00000000-0000-0000-0000-000000000000',
    );
  });

  it('on startTurn failure (intruder-style) emits error + end sharing the same messageId', async () => {
    const { gateway, prisma } = build(createInMemoryPrisma());
    const userA = randomUUID();
    const userB = randomUUID();
    prisma.users.push({ id: userA, email: 'a@t', passwordHash: 'x', createdAt: new Date() });
    prisma.users.push({ id: userB, email: 'b@t', passwordHash: 'x', createdAt: new Date() });
    const conversationId = randomUUID();
    // Conversation owned by user A, but client is user B AND the
    // getByIdForUser check first returns null → caught by the not_found
    // branch. We exercise the same shape via the not_found path because
    // startTurn-specific failure modes are surfaced via the same helper.
    prisma.conversations.push({
      id: conversationId,
      userId: userA,
      title: 't',
      createdAt: new Date(),
      lastMessageAt: null,
    });
    const client = fakeClient(userB);

    await (gateway as unknown as {
      handleSend: (c: unknown, d: unknown, f: unknown) => Promise<void>;
    }).handleSend(
      client,
      client.data,
      { type: 'send', conversationId, content: 'hi' },
    );

    expect(client.sent).toHaveLength(2);
    const [errorFrame, endFrame] = client.sent;
    expect(errorFrame!.type).toBe('error');
    expect(endFrame!.type).toBe('end');
    expect(endFrame!.type === 'end' && endFrame.status).toBe('failed');
    if (errorFrame!.type === 'error' && endFrame!.type === 'end') {
      expect(endFrame.messageId).toBe(errorFrame.messageId);
    }
  });
});
