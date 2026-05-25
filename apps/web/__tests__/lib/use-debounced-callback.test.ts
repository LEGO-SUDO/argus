// Tests for the trailing-edge debounce hook (LLD Tasks 58, 60).
import { renderHook, act } from '@testing-library/react';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('useDebouncedCallback (Task 58)', () => {
  it('fires the underlying callback exactly once at the window boundary under burst', () => {
    const cb = jest.fn();
    const { result } = renderHook(() => useDebouncedCallback(cb, 200));

    act(() => {
      result.current('a');
      result.current('b');
      result.current('c');
    });
    // Nothing fires until the window elapses.
    expect(cb).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(199);
    });
    expect(cb).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(cb).toHaveBeenCalledTimes(1);
    // Trailing edge fires with the LAST args.
    expect(cb).toHaveBeenCalledWith('c');
  });

  it('returns a stable function identity across renders', () => {
    const cb = jest.fn();
    const { result, rerender } = renderHook(
      ({ fn }) => useDebouncedCallback(fn, 100),
      { initialProps: { fn: cb } },
    );
    const first = result.current;
    rerender({ fn: jest.fn() });
    expect(result.current).toBe(first);
  });
});

describe('useDebouncedCallback cleanup (Task 60)', () => {
  it('cancels a pending invocation on unmount', () => {
    const cb = jest.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(cb, 200));
    act(() => {
      result.current('pending');
    });
    unmount();
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(cb).not.toHaveBeenCalled();
  });
});
