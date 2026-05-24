// Per-message monotonic sequence counter.
//
// Tasks 31/32. The gateway emits frames with strictly increasing `seq` per
// `messageId` (0 for start, 1..N for tokens, terminal-incremented for
// end/error/cancel-ack).
//
// Cleanup: orchestrator calls `registry.release(messageId)` when it emits
// the terminal frame; the gateway also calls release on disconnect as a
// backstop (Open Question — SeqCounterRegistry cleanup trigger).

export class SeqCounter {
  private value = -1;

  next(): number {
    this.value += 1;
    return this.value;
  }

  current(): number {
    return this.value;
  }
}

export class SeqCounterRegistry {
  private readonly counters = new Map<string, SeqCounter>();

  for(messageId: string): SeqCounter {
    let c = this.counters.get(messageId);
    if (!c) {
      c = new SeqCounter();
      this.counters.set(messageId, c);
    }
    return c;
  }

  release(messageId: string): void {
    this.counters.delete(messageId);
  }

  size(): number {
    return this.counters.size;
  }
}
