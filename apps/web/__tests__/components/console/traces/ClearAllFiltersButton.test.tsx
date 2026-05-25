// Tests for <ClearAllFiltersButton /> (LLD Tasks 100-101).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClearAllFiltersButton } from '@/components/console/traces/ClearAllFiltersButton';

describe('<ClearAllFiltersButton />', () => {
  it('fires the handler exactly once with no argument on click', async () => {
    const onClear = jest.fn();
    render(<ClearAllFiltersButton onClear={onClear} />);
    await userEvent.click(screen.getByTestId('console-filter-clear-all'));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClear.mock.calls[0]).toHaveLength(0);
  });
});
