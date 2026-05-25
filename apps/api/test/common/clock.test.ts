import { Clock, FakeClock } from '../../src/common/clock';

describe('Clock', () => {
  it('now() returns wall-clock time within 50ms of Date.now()', () => {
    const clock = new Clock();
    const before = Date.now();
    const got = clock.now();
    const after = Date.now();
    expect(got).toBeInstanceOf(Date);
    expect(got.getTime()).toBeGreaterThanOrEqual(before - 50);
    expect(got.getTime()).toBeLessThanOrEqual(after + 50);
  });

  it('nowMs() matches now() to the millisecond', () => {
    const clock = new Clock();
    const ms = clock.nowMs();
    expect(Math.abs(ms - clock.now().getTime())).toBeLessThanOrEqual(5);
  });
});

describe('FakeClock', () => {
  it('advance(ms) moves now()/nowMs() forward by exactly the supplied amount', () => {
    const start = new Date('2026-05-25T00:00:00.000Z');
    const clock = new FakeClock(start);
    expect(clock.now().toISOString()).toBe(start.toISOString());
    expect(clock.nowMs()).toBe(start.getTime());

    clock.advance(5_000);
    expect(clock.nowMs()).toBe(start.getTime() + 5_000);
    expect(clock.now().getTime()).toBe(start.getTime() + 5_000);

    clock.advance(1_234);
    expect(clock.nowMs()).toBe(start.getTime() + 6_234);
  });

  it('set() resets to an absolute time', () => {
    const clock = new FakeClock(0);
    clock.set(new Date('2026-01-01T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
