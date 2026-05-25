// Clock — injectable wall-clock wrapper.
//
// Every Phase B service that reasons about elapsed time (janitor stranded
// threshold, live-badge lag, heartbeat cadence, clear fence timestamp) injects
// this instead of calling `Date.now()` directly, so unit tests can substitute
// `FakeClock` and advance time deterministically without real waits.
import { Injectable } from '@nestjs/common';

/** Minimal time surface the services depend on. */
export interface ClockLike {
  now(): Date;
  nowMs(): number;
}

@Injectable()
export class Clock implements ClockLike {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}

/**
 * Deterministic test clock. Constructed with an initial timestamp; `advance`
 * moves the returned time forward by an exact amount. Structurally compatible
 * with `Clock`, so it drops into a Nest provider override or a direct
 * constructor injection in unit tests.
 */
export class FakeClock implements ClockLike {
  private currentMs: number;

  constructor(initial: Date | number = Date.now()) {
    this.currentMs = typeof initial === 'number' ? initial : initial.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  nowMs(): number {
    return this.currentMs;
  }

  /** Move the clock forward by exactly `ms` milliseconds. */
  advance(ms: number): void {
    this.currentMs += ms;
  }

  /** Reset the clock to an absolute time. */
  set(at: Date | number): void {
    this.currentMs = typeof at === 'number' ? at : at.getTime();
  }
}
