// Tests for <TracesFilterBar /> (LLD Tasks 102-105).
//
// Reskin delta: the filter bar is now a fragment of .filter-chip triggers and
// inline elements inside .con-tools. Each multi-select trigger opens a dropdown;
// tests open the trigger first before selecting an option. All behavioral
// coverage (AND-combined emit, clear-all) is unchanged.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TracesFilterBar } from '@/components/console/traces/TracesFilterBar';
import { emptyTracesFilter, type TracesFilter } from '@/lib/traces-filter-encoding';

const baseProps = {
  models: ['gpt-4o'],
  conversations: [{ id: 'c-1', title: 'Convo' }],
};

describe('<TracesFilterBar /> AND-combined emit (Task 102)', () => {
  it('merges a sub-control change into the current filter and emits the combined object', async () => {
    const onChange = jest.fn();
    const value: TracesFilter = { ...emptyTracesFilter(), status: ['failed'] };
    render(<TracesFilterBar value={value} onChange={onChange} {...baseProps} />);
    // Open the provider dropdown first, then click the openai chip
    await userEvent.click(screen.getByTestId('console-filter-provider-trigger'));
    await userEvent.click(screen.getByTestId('console-filter-provider-openai'));
    expect(onChange).toHaveBeenCalledWith({
      ...emptyTracesFilter(),
      status: ['failed'],
      provider: ['openai'],
    });
  });
});

describe('<TracesFilterBar /> clear-all (Task 104)', () => {
  it('emits the empty filter object', async () => {
    const onChange = jest.fn();
    const value: TracesFilter = {
      provider: ['openai'],
      model: ['gpt-4o'],
      status: ['ok'],
      conversationId: ['c-1'],
      search: 'x',
    };
    render(<TracesFilterBar value={value} onChange={onChange} {...baseProps} />);
    await userEvent.click(screen.getByTestId('console-filter-clear-all'));
    expect(onChange).toHaveBeenCalledWith(emptyTracesFilter());
  });
});
