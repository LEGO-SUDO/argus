import { Test } from '@nestjs/testing';
import { JanitorModule } from '../../src/janitor/janitor.module';
import { JanitorService } from '../../src/janitor/janitor.service';
import { JanitorScheduler } from '../../src/janitor/scheduler';
import { PRISMA_CLIENT_TOKEN } from '../../src/common/prisma.service';
import { createInMemoryPrisma } from '../fixtures/prisma-test-client';

describe('JanitorModule + scheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves both services; start() sweeps immediately, interval repeats, stop() halts', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [JanitorModule] })
      .overrideProvider(PRISMA_CLIENT_TOKEN)
      .useValue(createInMemoryPrisma())
      .compile();
    const janitor = moduleRef.get(JanitorService);
    const scheduler = moduleRef.get(JanitorScheduler);
    expect(janitor).toBeInstanceOf(JanitorService);
    expect(scheduler).toBeInstanceOf(JanitorScheduler);

    const sweep = jest.spyOn(janitor, 'sweep').mockResolvedValue(0);
    scheduler.start();
    expect(sweep).toHaveBeenCalledTimes(1); // immediate boot sweep
    jest.advanceTimersByTime(30_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    scheduler.stop();
    jest.advanceTimersByTime(60_000);
    expect(sweep).toHaveBeenCalledTimes(2); // no further sweeps after stop
    await moduleRef.close();
  });
});
