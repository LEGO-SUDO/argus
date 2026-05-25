// Tests for <ConversationMultiSelect /> (LLD Tasks 96-97).
//
// Reskin delta: chips live in a dropdown. Tests open the trigger first.
// All behavioral assertions are unchanged.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationMultiSelect } from '@/components/console/traces/ConversationMultiSelect';

const CONVOS = [
  { id: 'c-1', title: 'Weekend plans' },
  { id: 'c-2', title: 'Bug triage' },
];

describe('<ConversationMultiSelect />', () => {
  it('renders each conversation title and emits the toggled id array', async () => {
    const onChange = jest.fn();
    render(<ConversationMultiSelect conversations={CONVOS} selected={[]} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('console-filter-conversation-trigger'));
    expect(screen.getByTestId('console-filter-conversation-c-1')).toHaveTextContent('Weekend plans');
    await userEvent.click(screen.getByTestId('console-filter-conversation-c-2'));
    expect(onChange).toHaveBeenLastCalledWith(['c-2']);
  });
});
