import { Test } from '@nestjs/testing';
import { HeartbeatModule } from '../../src/heartbeat/heartbeat.module';
import { HeartbeatScheduler } from '../../src/heartbeat/scheduler';
import * as emitter from '../../src/heartbeat/span-emitter';

describe('HeartbeatModule + scheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves the scheduler; start() emits immediately, interval repeats, stop() halts', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HeartbeatModule] }).compile();
    const scheduler = moduleRef.get(HeartbeatScheduler);
    expect(scheduler).toBeInstanceOf(HeartbeatScheduler);

    const emit = jest.spyOn(emitter, 'emitHeartbeatSpan').mockImplementation(() => undefined);
    scheduler.start();
    expect(emit).toHaveBeenCalledTimes(1); // immediate
    jest.advanceTimersByTime(10_000);
    expect(emit).toHaveBeenCalledTimes(2);
    scheduler.stop();
    jest.advanceTimersByTime(30_000);
    expect(emit).toHaveBeenCalledTimes(2);
    emit.mockRestore();
    await moduleRef.close();
  });

  it('swallows an emit failure so the interval keeps ticking', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HeartbeatModule] }).compile();
    const scheduler = moduleRef.get(HeartbeatScheduler);
    const emit = jest.spyOn(emitter, 'emitHeartbeatSpan').mockImplementation(() => {
      throw new Error('tracer down');
    });
    expect(() => scheduler.start()).not.toThrow();
    jest.advanceTimersByTime(10_000);
    expect(emit).toHaveBeenCalledTimes(2);
    scheduler.stop();
    emit.mockRestore();
    await moduleRef.close();
  });
});
