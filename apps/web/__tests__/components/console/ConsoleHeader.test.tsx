// Tests for <ConsoleHeader /> active-tab highlight (LLD Reviewer Concern:
// active-tab aria-current was previously manual-only).
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  usePathname: () => '/console/cost',
  useRouter: () => ({ refresh: jest.fn() }),
}));
jest.mock('@/lib/use-live-badge', () => ({
  useLiveBadge: () => ({ state: 'live', label: 'Live', refetch: jest.fn() }),
}));
jest.mock('@/lib/console-api', () => ({
  generateSample: jest.fn(),
  previewClear: jest.fn(),
  executeClear: jest.fn(),
}));

import { ConsoleHeader } from '@/components/console/ConsoleHeader';

describe('<ConsoleHeader />', () => {
  it('marks the active tab with aria-current="page"', () => {
    render(<ConsoleHeader />);
    expect(screen.getByTestId('console-tab-cost')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('console-tab-traces')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('console-tab-replay')).not.toHaveAttribute('aria-current');
  });

  it('renders the live badge, sample button, and clear button', () => {
    render(<ConsoleHeader />);
    expect(screen.getByTestId('console-live-badge')).toBeInTheDocument();
    expect(screen.getByTestId('console-sample-data-button')).toBeInTheDocument();
    expect(screen.getByTestId('console-clear-button')).toBeInTheDocument();
  });
});
