// Tasks 31 (RED) / 32 (GREEN) — SeqCounter + SeqCounterRegistry.
import { SeqCounter, SeqCounterRegistry } from '../../src/chat/seq-counter';

describe('SeqCounter', () => {
  it('next() returns 0, 1, 2, 3... on successive calls', () => {
    const c = new SeqCounter();
    expect(c.next()).toBe(0);
    expect(c.next()).toBe(1);
    expect(c.next()).toBe(2);
    expect(c.next()).toBe(3);
  });

  it('independent instances do not share state', () => {
    const a = new SeqCounter();
    const b = new SeqCounter();
    a.next();
    a.next();
    expect(b.next()).toBe(0);
    expect(a.next()).toBe(2);
  });
});

describe('SeqCounterRegistry', () => {
  it('per-message counters are isolated by message id', () => {
    const r = new SeqCounterRegistry();
    const a = r.for('msg-a');
    const b = r.for('msg-b');
    expect(a.next()).toBe(0);
    expect(b.next()).toBe(0);
    expect(a.next()).toBe(1);
    expect(b.next()).toBe(1);
  });

  it('repeated for(messageId) returns the same counter', () => {
    const r = new SeqCounterRegistry();
    const a1 = r.for('msg-a');
    a1.next();
    const a2 = r.for('msg-a');
    expect(a2.next()).toBe(1);
  });

  it('release(messageId) drops the counter so a fresh one starts at 0', () => {
    const r = new SeqCounterRegistry();
    const a = r.for('msg-a');
    a.next();
    a.next();
    r.release('msg-a');
    expect(r.size()).toBe(0);
    const fresh = r.for('msg-a');
    expect(fresh.next()).toBe(0);
  });
});
