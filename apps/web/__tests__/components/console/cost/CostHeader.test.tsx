// Tests for <CostHeader /> (LLD Tasks 128-133).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CostHeader } from '@/components/console/cost/CostHeader';

const noop = () => undefined;

describe('<CostHeader /> total + sparkline (Task 128)', () => {
  it('renders the total rounded to display cents and mounts the sparkline', () => {
    render(
      <CostHeader totalMicroUsd={2_500_000} sparkline={[1, 2, 3]} groupBy="conversation" onGroupByChange={noop} />,
    );
    expect(screen.getByTestId('console-cost-total')).toHaveTextContent('$2.50');
    expect(screen.getByTestId('console-sparkline')).toBeInTheDocument();
  });
});

describe('<CostHeader /> sub-cent + zero (Task 130)', () => {
  it('shows "< $0.01" for a positive sub-cent total', () => {
    render(<CostHeader totalMicroUsd={5_000} sparkline={[]} groupBy="provider" onGroupByChange={noop} />);
    expect(screen.getByTestId('console-cost-total')).toHaveTextContent('< $0.01');
  });
  it('shows "$0.00" for a true-zero total', () => {
    render(<CostHeader totalMicroUsd={0} sparkline={[]} groupBy="provider" onGroupByChange={noop} />);
    expect(screen.getByTestId('console-cost-total')).toHaveTextContent('$0.00');
    expect(screen.getByTestId('console-cost-total')).not.toHaveTextContent('<');
  });
});

describe('<CostHeader /> regroup toggle (Task 132)', () => {
  it('emits the chosen group-by value', async () => {
    const onGroupByChange = jest.fn();
    render(<CostHeader totalMicroUsd={0} sparkline={[]} groupBy="conversation" onGroupByChange={onGroupByChange} />);
    await userEvent.click(screen.getByTestId('console-cost-groupby-provider'));
    expect(onGroupByChange).toHaveBeenCalledWith('provider');
  });
});
