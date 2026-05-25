// SseHub — in-process fan-out from the live-events consumer to open `/console/
// live` SSE streams. Map<userId, { subscribers, pendingTick, timer }>.
//
// Per-user debounce: a burst of ticks (e.g. a Generate-Samples run firing N
// turns) coalesces into ONE tick per debounce window so the console refetches
// once rather than N times. Publishing to a user with no subscribers is a
// no-op that retains nothing (no replay on a future subscribe).
import { Inject, Injectable } from '@nestjs/common';
import type { SseTick } from '@argus/contracts';
import { API_CONFIG_TOKEN, type ApiConfig } from '../common/config';

export type SseSubscriber = (tick: SseTick) => void;

interface UserEntry {
  subscribers: Set<SseSubscriber>;
  pendingTick: SseTick | null;
  timer: NodeJS.Timeout | null;
}

@Injectable()
export class SseHub {
  private readonly users = new Map<string, UserEntry>();

  constructor(@Inject(API_CONFIG_TOKEN) private readonly config: ApiConfig) {}

  /** Subscribe a callback; returns the unsubscribe handle. */
  subscribe(userId: string, cb: SseSubscriber): () => void {
    let entry = this.users.get(userId);
    if (!entry) {
      entry = { subscribers: new Set(), pendingTick: null, timer: null };
      this.users.set(userId, entry);
    }
    entry.subscribers.add(cb);
    return () => this.unsubscribe(userId, cb);
  }

  private unsubscribe(userId: string, cb: SseSubscriber): void {
    const entry = this.users.get(userId);
    if (!entry) return;
    entry.subscribers.delete(cb);
    this.gc(userId, entry);
  }

  private gc(userId: string, entry: UserEntry): void {
    if (entry.subscribers.size === 0 && entry.timer === null) {
      this.users.delete(userId);
    }
  }

  /** Coalesce a tick for a user and broadcast it after the debounce window. */
  publish(userId: string, tick: SseTick): void {
    const entry = this.users.get(userId);
    // No subscribers → no-op, retain nothing.
    if (!entry || entry.subscribers.size === 0) return;

    entry.pendingTick = tick;
    if (entry.timer === null) {
      entry.timer = setTimeout(() => {
        const pending = entry.pendingTick;
        entry.pendingTick = null;
        entry.timer = null;
        if (pending) {
          for (const cb of entry.subscribers) cb(pending);
        }
        this.gc(userId, entry);
      }, this.config.sseDebounceMs);
      // Don't let a pending debounce window hold the event loop open at shutdown.
      entry.timer.unref?.();
    }
  }
}
