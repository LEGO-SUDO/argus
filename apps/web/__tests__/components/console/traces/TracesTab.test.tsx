// Tests for <TracesTab /> (LLD Tasks 118-123).
//
// Mocks the data fetch, the live-tick context, and next/navigation so we can
// assert URL-sync-on-mount, debounced filter-change refetch, and SSE-tick
// refetch coalescing without a real provider / router.
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockReplace = jest.fn();
const mockSubscribe = jest.fn(
  (_predicate: unknown, _listener: () => void): (() => void) => () => undefined,
);

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/console/traces',
}));
jest.mock('@/lib/use-console-live', () => ({
  useConsoleLive: () => ({ latestTick: null, subscribe: mockSubscribe }),
}));
jest.mock('@/lib/console-api', () => ({ fetchTraces: jest.fn() }));

import { fetchTraces } from '@/lib/console-api';
import { TracesTab } from '@/components/console/traces/TracesTab';
import type { TraceListResponse } from '@argus/contracts';

const mockFetchTraces = fetchTraces as jest.Mock;

const EMPTY_DATA: TraceListResponse = {
  rows: [],
  throughput: { turnsPerHour: 0, tokensPerHour: 0, errorRate: 0 },
  next_cursor: null,
};

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockReset();
  mockSubscribe.mockClear();
  mockFetchTraces.mockReset().mockResolvedValue(EMPTY_DATA);
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('<TracesTab /> URL sync on mount (Task 118)', () => {
  it('rehydrates the filter from URL params', () => {
    render(
      <TracesTab
        initialData={EMPTY_DATA}
        initialWindow="24h"
        initialSearchParams={new URLSearchParams('provider=openai')}
      />,
    );
    expect(screen.getByTestId('console-filter-provider-openai')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('leaves the bar empty with no params', () => {
    render(<TracesTab initialData={EMPTY_DATA} initialWindow="24h" />);
    expect(screen.getByTestId('console-filter-provider-openai')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('<TracesTab /> debounced filter refetch (Task 120)', () => {
  it('coalesces rapid filter changes into one refetch carrying the latest filter', async () => {
    render(
      <TracesTab initialData={EMPTY_DATA} initialWindow="24h" refetchDebounceMs={200} />,
    );
    fireEvent.click(screen.getByTestId('console-filter-provider-openai'));
    fireEvent.click(screen.getByTestId('console-filter-provider-anthropic'));
    fireEvent.click(screen.getByTestId('console-filter-provider-gemini'));
    expect(mockFetchTraces).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(mockFetchTraces).toHaveBeenCalledTimes(1);
    expect(mockFetchTraces.mock.calls[0]![0]).toMatchObject({
      window: '24h',
      filter: expect.objectContaining({ provider: ['openai', 'anthropic', 'gemini'] }),
    });
    // The filter change is also pushed to the URL (deep-link support).
    expect(mockReplace).toHaveBeenCalled();
  });
});

describe('<TracesTab /> live-tick refetch (Task 122)', () => {
  it('refetches on a tick and coalesces a burst into one refetch', async () => {
    render(
      <TracesTab initialData={EMPTY_DATA} initialWindow="7d" refetchDebounceMs={200} />,
    );
    // The tab registered a subscriber; grab its listener and fire a burst.
    const listener = mockSubscribe.mock.calls[0]![1] as () => void;
    act(() => {
      listener();
      listener();
      listener();
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(mockFetchTraces).toHaveBeenCalledTimes(1);
    expect(mockFetchTraces.mock.calls[0]![0]).toMatchObject({ window: '7d' });
  });
});
