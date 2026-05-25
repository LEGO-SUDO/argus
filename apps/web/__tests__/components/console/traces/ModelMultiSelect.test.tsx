// Tests for <ModelMultiSelect /> (LLD Tasks 92-93).
//
// Reskin delta: chips live in a dropdown. Tests open the trigger first.
// All behavioral assertions are unchanged.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelMultiSelect } from '@/components/console/traces/ModelMultiSelect';

describe('<ModelMultiSelect />', () => {
  it('renders the prop-supplied models and emits the toggled array', async () => {
    const onChange = jest.fn();
    render(
      <ModelMultiSelect models={['gpt-4o', 'claude-3-7']} selected={[]} onChange={onChange} />,
    );
    await userEvent.click(screen.getByTestId('console-filter-model-trigger'));
    expect(screen.getByTestId('console-filter-model-gpt-4o')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('console-filter-model-claude-3-7'));
    expect(onChange).toHaveBeenLastCalledWith(['claude-3-7']);
  });

  it('marks selected models with aria-pressed', async () => {
    render(<ModelMultiSelect models={['gpt-4o']} selected={['gpt-4o']} onChange={() => undefined} />);
    await userEvent.click(screen.getByTestId('console-filter-model-trigger'));
    expect(screen.getByTestId('console-filter-model-gpt-4o')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
