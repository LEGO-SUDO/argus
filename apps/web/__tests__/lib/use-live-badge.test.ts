// Tests for the useLiveBadge polling hook (LLD Tasks 24, 26, 28).
import { renderHook, act } from '@testing-library/react';

jest.mock('@/lib/console-api', () => ({
  fetchBadgeLag: jest.fn(),
}));

import { fetchBadgeLag } from '@/lib/console-api';
import { useLiveBadge } from '@/lib/use-live-badge';

const mockFetch = fetchBadgeLag as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useLiveBadge polling (Task 24)', () => {
  it('fetches on mount and once per cadence tick, exposing the derived state', async () => {
    mockFetch.mockResolvedValue({ state: 'live', lagSeconds: 0 });
    const { result } = renderHook(() => useLiveBadge({ cadenceMs: 1000 }));

    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('live');
    expect(result.current.label).toBe('Live');

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('derives behind from a lagging response', async () => {
    mockFetch.mockResolvedValue({ state: 'behind', lagSeconds: 12 });
    const { result } = renderHook(() => useLiveBadge({ cadenceMs: 1000 }));
    await flush();
    expect(result.current.state).toBe('behind');
    expect(result.current.label).toContain('12');
  });
});

describe('useLiveBadge fetch errors (Task 26)', () => {
  it('surfaces a rejected fetch as state=error with the ingestion-failure label', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useLiveBadge({ cadenceMs: 1000 }));
    await flush();
    expect(result.current.state).toBe('error');
    expect(result.current.label).toMatch(/ingestion failure/i);
  });
});

describe('useLiveBadge unmount safety (Task 28)', () => {
  it('drops a fetch that resolves after unmount without updating state or warning', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let resolve!: (value: { state: string; lagSeconds: number }) => void;
    mockFetch.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { unmount } = renderHook(() => useLiveBadge({ cadenceMs: 1000 }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      resolve({ state: 'behind', lagSeconds: 10 });
      await Promise.resolve();
    });
    // No act/setState-after-unmount warning leaked.
    const warned = errorSpy.mock.calls.some((c) =>
      String(c[0]).match(/unmounted|not wrapped in act/i),
    );
    expect(warned).toBe(false);
    errorSpy.mockRestore();
  });
});

describe('useLiveBadge refetch handle (Task 31 dependency)', () => {
  it('exposes a refetch function that triggers another fetch', async () => {
    mockFetch.mockResolvedValue({ state: 'live', lagSeconds: 0 });
    const { result } = renderHook(() => useLiveBadge({ cadenceMs: 100000 }));
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
