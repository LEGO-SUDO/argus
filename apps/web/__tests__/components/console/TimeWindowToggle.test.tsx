// Tests for <TimeWindowToggle /> (LLD Tasks 72-73).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimeWindowToggle } from '@/components/console/TimeWindowToggle';

describe('<TimeWindowToggle />', () => {
  it('emits the clicked window value', async () => {
    const onChange = jest.fn();
    render(<TimeWindowToggle value="24h" onChange={onChange} />);
    await userEvent.click(screen.getByTestId('console-time-window-7d'));
    expect(onChange).toHaveBeenCalledWith('7d');
    await userEvent.click(screen.getByTestId('console-time-window-all'));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('marks the selected option with aria-pressed=true', () => {
    render(<TimeWindowToggle value="7d" onChange={() => undefined} />);
    expect(screen.getByTestId('console-time-window-7d')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('console-time-window-24h')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('console-time-window-all')).toHaveAttribute('aria-pressed', 'false');
  });
});
