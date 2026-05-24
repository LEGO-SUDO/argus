// Regression test for the offset-commit bug.
//
// The consumer runs with `autoCommit: false`. Calling
// `commitOffsetsIfNecessary()` with NO arguments is a no-op in that mode, so
// resolved offsets never reach the broker and the group re-reads the same
// messages forever (endless duplicate-skip churn, lag never clears). The fix
// commits the resolved offsets explicitly. These tests pin that behavior.
import { ProjectionConsumer } from '../src/projection/projection.consumer';
import type { ProjectionService } from '../src/projection/projection.service';

function mockService(): ProjectionService {
  return { handle: jest.fn().mockResolvedValue(undefined) } as unknown as ProjectionService;
}

// A decodable record with zero spans — enough to exercise the resolve/commit
// path without needing a full OTLP fixture (offsets resolve per message
// regardless of span count).
function msg(offset: string): { offset: string; value: Buffer; key: null } {
  return { offset, value: Buffer.from('{"resourceSpans":[]}'), key: null };
}

interface MockPayload {
  batch: { partition: number; messages: ReturnType<typeof msg>[] };
  resolveOffset: jest.Mock;
  heartbeat: jest.Mock;
  commitOffsetsIfNecessary: jest.Mock;
  isRunning: () => boolean;
  isStale: () => boolean;
}

function makePayload(overrides: Partial<MockPayload> = {}): MockPayload {
  return {
    batch: { partition: 1, messages: [msg('0'), msg('1')] },
    resolveOffset: jest.fn(),
    heartbeat: jest.fn().mockResolvedValue(undefined),
    commitOffsetsIfNecessary: jest.fn().mockResolvedValue(undefined),
    isRunning: () => true,
    isStale: () => false,
    ...overrides,
  };
}

describe('ProjectionConsumer.handleBatch — offset commit', () => {
  it('commits the resolved offsets explicitly (lastProcessed + 1) so the group advances', async () => {
    const consumer = new ProjectionConsumer(mockService());
    const payload = makePayload();

    // handleBatch is private; exercise it directly for this unit test.
    await (consumer as unknown as {
      handleBatch(p: MockPayload, t: string): Promise<void>;
    }).handleBatch(payload, 'traces');

    expect(payload.resolveOffset).toHaveBeenCalledWith('0');
    expect(payload.resolveOffset).toHaveBeenCalledWith('1');
    // Regression guard: commit MUST carry offsets. A bare
    // commitOffsetsIfNecessary() is a no-op under autoCommit:false.
    expect(payload.commitOffsetsIfNecessary).toHaveBeenCalledTimes(1);
    expect(payload.commitOffsetsIfNecessary).toHaveBeenCalledWith({
      topics: [{ topic: 'traces', partitions: [{ partition: 1, offset: '2' }] }],
    });
  });

  it('does not commit when the batch is stale before any message is processed', async () => {
    const consumer = new ProjectionConsumer(mockService());
    const payload = makePayload({ isStale: () => true });

    await (consumer as unknown as {
      handleBatch(p: MockPayload, t: string): Promise<void>;
    }).handleBatch(payload, 'traces');

    expect(payload.resolveOffset).not.toHaveBeenCalled();
    expect(payload.commitOffsetsIfNecessary).not.toHaveBeenCalled();
  });
});
