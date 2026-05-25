import { randomUUID } from 'crypto';
import {
  reconstructReplayInput,
  type ReplayHistoryMessage,
} from '../../src/replay/replay-input-reconstructor';

const base = new Date('2026-05-25T00:00:00.000Z').getTime();
function msg(role: ReplayHistoryMessage['role'], content: string, offsetMs: number): ReplayHistoryMessage {
  return { id: randomUUID(), role, content, createdAt: new Date(base + offsetMs) };
}

describe('reconstructReplayInput', () => {
  it('returns system + user message + history + temperature + maxTokens', () => {
    const userMsg = msg('user', 'final question', 3000);
    const out = reconstructReplayInput({
      source: { conversationId: randomUUID(), system: 'you are helpful', temperature: 0.7, maxTokens: 512 },
      triggeringUserMessage: userMsg,
      history: [msg('system', 'sys', 0), msg('user', 'q1', 1000), msg('assistant', 'a1', 2000), userMsg],
    });
    expect(out.system).toBe('you are helpful');
    expect(out.temperature).toBe(0.7);
    expect(out.maxTokens).toBe(512);
    expect(out.userMessage).toEqual({ role: 'user', content: 'final question' });
    expect(out.history.map((h) => h.content)).toEqual(['sys', 'q1', 'a1', 'final question']);
  });

  it('excludes messages created after the triggering user message; includes it exactly once', () => {
    const userMsg = msg('user', 'trigger', 2000);
    const out = reconstructReplayInput({
      source: { conversationId: randomUUID() },
      triggeringUserMessage: userMsg,
      history: [
        msg('user', 'older', 1000),
        userMsg,
        msg('assistant', 'the assistant turn that followed', 3000), // after boundary → excluded
        msg('user', 'a later turn', 4000), // after boundary → excluded
      ],
    });
    expect(out.history.map((h) => h.content)).toEqual(['older', 'trigger']);
    expect(out.history.filter((h) => h.content === 'trigger')).toHaveLength(1);
  });

  it('drops tools / attachments / provider-specific fields from the source', () => {
    const userMsg = msg('user', 'q', 1000);
    const out = reconstructReplayInput({
      source: {
        conversationId: randomUUID(),
        system: 's',
        tools: [{ name: 'calculator' }],
        attachments: ['file.pdf'],
        providerSpecific: { openaiSeed: 42 },
      },
      triggeringUserMessage: userMsg,
      history: [userMsg],
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('calculator');
    expect(serialized).not.toContain('attachments');
    expect(serialized).not.toContain('providerSpecific');
    expect(Object.keys(out).sort()).toEqual(['history', 'maxTokens', 'system', 'temperature', 'userMessage']);
  });
});
