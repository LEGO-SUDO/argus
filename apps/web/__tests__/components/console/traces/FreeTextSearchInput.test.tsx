// Tests for <FreeTextSearchInput /> (LLD Tasks 98-99).
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FreeTextSearchInput } from '@/components/console/traces/FreeTextSearchInput';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('<FreeTextSearchInput />', () => {
  it('debounces and emits the trimmed query once at the window boundary', () => {
    const onChange = jest.fn();
    render(<FreeTextSearchInput onChange={onChange} debounceMs={200} />);
    const input = screen.getByTestId('console-filter-search-input');

    fireEvent.change(input, { target: { value: 'to' } });
    fireEvent.change(input, { target: { value: 'tok' } });
    fireEvent.change(input, { target: { value: '  tokens  ' } });
    expect(onChange).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(200));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('tokens');
  });

  it('emits an empty string when cleared', () => {
    const onChange = jest.fn();
    render(<FreeTextSearchInput initialValue="x" onChange={onChange} debounceMs={100} />);
    const input = screen.getByTestId('console-filter-search-input');
    fireEvent.change(input, { target: { value: '' } });
    act(() => jest.advanceTimersByTime(100));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
