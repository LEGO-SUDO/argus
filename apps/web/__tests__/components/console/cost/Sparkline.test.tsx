// Tests for <Sparkline /> (LLD Tasks 124-127).
import { render, screen } from '@testing-library/react';
import { Sparkline } from '@/components/console/cost/Sparkline';

describe('<Sparkline />', () => {
  it('renders a path for a non-empty series (Task 124)', () => {
    render(<Sparkline values={[1, 5, 2, 8]} />);
    const path = screen.getByTestId('console-sparkline-path');
    expect(path).toBeInTheDocument();
    expect(path.getAttribute('d')?.length ?? 0).toBeGreaterThan(0);
  });

  it('renders no path for an empty series (Task 124)', () => {
    render(<Sparkline values={[]} />);
    expect(screen.getByTestId('console-sparkline')).toBeInTheDocument();
    expect(screen.queryByTestId('console-sparkline-path')).toBeNull();
  });

  it('renders flat data without crashing (Task 126)', () => {
    render(<Sparkline values={[4, 4, 4, 4]} />);
    const path = screen.getByTestId('console-sparkline-path');
    // No NaN in the path — divide-by-zero is guarded.
    expect(path.getAttribute('d')).not.toMatch(/NaN/);
  });
});
