// Tests for <StatusMultiSelect /> (LLD Tasks 94-95).
//
// Reskin delta: chips live in a dropdown. Tests open the trigger first.
// All behavioral assertions are unchanged.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusMultiSelect } from '@/components/console/traces/StatusMultiSelect';

describe('<StatusMultiSelect />', () => {
  it('renders the contract statuses and emits the toggled array', async () => {
    const onChange = jest.fn();
    render(<StatusMultiSelect selected={[]} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('console-filter-status-trigger'));
    for (const s of ['ok', 'streaming', 'failed', 'canceled', 'timed_out']) {
      expect(screen.getByTestId(`console-filter-status-${s}`)).toBeInTheDocument();
    }
    await userEvent.click(screen.getByTestId('console-filter-status-failed'));
    expect(onChange).toHaveBeenLastCalledWith(['failed']);
  });
});
