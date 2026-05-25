import { Test } from '@nestjs/testing';
import { LiveEventsModule } from '../../src/console/live-events.module';
import { LiveEventsConsumer } from '../../src/console/live-events.consumer';
import { SseHub } from '../../src/console/sse-hub';

describe('LiveEventsModule', () => {
  it('compiles and resolves LiveEventsConsumer + SseHub', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [LiveEventsModule] }).compile();
    expect(moduleRef.get(LiveEventsConsumer)).toBeInstanceOf(LiveEventsConsumer);
    expect(moduleRef.get(SseHub)).toBeInstanceOf(SseHub);
    await moduleRef.close();
  });
});
