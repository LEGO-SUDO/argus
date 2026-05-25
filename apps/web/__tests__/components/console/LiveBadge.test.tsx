// Tests for <LiveBadge /> (LLD Tasks 30, 31). The hook is stubbed so we drive
// each visual state directly.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/use-live-badge', () => ({ useLiveBadge: jest.fn() }));

import { useLiveBadge } from '@/lib/use-live-badge';
import { LiveBadge } from '@/components/console/LiveBadge';

const mockHook = useLiveBadge as jest.Mock;

beforeEach(() => mockHook.mockReset());

describe('<LiveBadge /> visual states (Task 30)', () => {
  it('renders the live state with an accessible status', () => {
    mockHook.mockReturnValue({ state: 'live', label: 'Live', refetch: jest.fn() });
    render(<LiveBadge />);
    const badge = screen.getByTestId('console-live-badge');
    expect(badge).toHaveAttribute('data-state', 'live');
    expect(badge).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('console-live-badge-label')).toHaveTextContent('Live');
    expect(screen.queryByTestId('console-live-badge-retry')).toBeNull();
  });

  it('renders the behind state with its lag label', () => {
    mockHook.mockReturnValue({ state: 'behind', label: '12s behind', refetch: jest.fn() });
    render(<LiveBadge />);
    expect(screen.getByTestId('console-live-badge')).toHaveAttribute('data-state', 'behind');
    expect(screen.getByTestId('console-live-badge-label')).toHaveTextContent('12s behind');
    expect(screen.queryByTestId('console-live-badge-retry')).toBeNull();
  });

  it('renders the error state with a Retry control', () => {
    mockHook.mockReturnValue({ state: 'error', label: 'Ingestion failure', refetch: jest.fn() });
    render(<LiveBadge />);
    expect(screen.getByTestId('console-live-badge')).toHaveAttribute('data-state', 'error');
    expect(screen.getByTestId('console-live-badge-retry')).toBeInTheDocument();
  });
});

describe('<LiveBadge /> Retry (Task 31)', () => {
  it('invokes the hook refetch when Retry is clicked', async () => {
    const refetch = jest.fn().mockResolvedValue(undefined);
    mockHook.mockReturnValue({ state: 'error', label: 'Ingestion failure', refetch });
    render(<LiveBadge />);
    await userEvent.click(screen.getByTestId('console-live-badge-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('announces politely via aria-live', () => {
    mockHook.mockReturnValue({ state: 'live', label: 'Live', refetch: jest.fn() });
    render(<LiveBadge />);
    expect(screen.getByTestId('console-live-badge')).toHaveAttribute('aria-live', 'polite');
  });
});
