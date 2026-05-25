// Tests for <CostTab /> (LLD Tasks 144-149).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockReplace = jest.fn();
const mockSubscribe = jest.fn(
  (_predicate: unknown, _listener: () => void): (() => void) => () => undefined,
);

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/console/cost',
}));
jest.mock('@/lib/use-console-live', () => ({
  useConsoleLive: () => ({ latestTick: null, subscribe: mockSubscribe }),
}));
jest.mock('@/lib/console-api', () => ({ fetchCost: jest.fn() }));

import { fetchCost } from '@/lib/console-api';
import { CostTab } from '@/components/console/cost/CostTab';
import type { CostResponse } from '@argus/contracts';

const mockFetchCost = fetchCost as jest.Mock;

const EMPTY: CostResponse = {
  groups: [],
  total_micro_usd: 0,
  sparkline: [],
  unpriced_models: [],
};

beforeEach(() => {
  mockReplace.mockReset();
  mockSubscribe.mockClear();
  mockFetchCost.mockReset().mockResolvedValue(EMPTY);
});

describe('<CostTab /> window sync (Task 144)', () => {
  it('rehydrates the window toggle from the server-resolved initial window', () => {
    render(<CostTab initialData={EMPTY} initialWindow="7d" />);
    expect(screen.getByTestId('console-time-window-7d')).toHaveAttribute('aria-pressed', 'true');
  });

  it('defaults to 24h with no param', () => {
    render(<CostTab initialData={EMPTY} />);
    expect(screen.getByTestId('console-time-window-24h')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('<CostTab /> group-by refetch (Task 146)', () => {
  it('refetches exactly once with the new group-by value', async () => {
    render(<CostTab initialData={EMPTY} />);
    await userEvent.click(screen.getByTestId('console-cost-groupby-provider'));
    await waitFor(() => expect(mockFetchCost).toHaveBeenCalledTimes(1));
    expect(mockFetchCost.mock.calls[0]![0]).toMatchObject({ groupBy: 'provider' });
  });
});

describe('<CostTab /> sparkline series from response (Task 148)', () => {
  it('passes the fetched sparkline series into the header', async () => {
    // Initial data has no sparkline (no path); a refetch returns one.
    mockFetchCost.mockResolvedValue({
      ...EMPTY,
      sparkline: [
        { hourStart: '2026-05-25T10:00:00Z', costMicros: 100 },
        { hourStart: '2026-05-25T11:00:00Z', costMicros: 500 },
      ],
    });
    render(<CostTab initialData={EMPTY} />);
    expect(screen.queryByTestId('console-sparkline-path')).toBeNull();
    await userEvent.click(screen.getByTestId('console-cost-groupby-model'));
    await waitFor(() =>
      expect(screen.getByTestId('console-sparkline-path')).toBeInTheDocument(),
    );
  });
});
