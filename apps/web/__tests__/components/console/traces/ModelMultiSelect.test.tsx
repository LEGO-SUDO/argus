// Tests for <ModelMultiSelect /> (LLD Tasks 92-93).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelMultiSelect } from '@/components/console/traces/ModelMultiSelect';

describe('<ModelMultiSelect />', () => {
  it('renders the prop-supplied models and emits the toggled array', async () => {
    const onChange = jest.fn();
    render(
      <ModelMultiSelect models={['gpt-4o', 'claude-3-7']} selected={[]} onChange={onChange} />,
    );
    expect(screen.getByTestId('console-filter-model-gpt-4o')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('console-filter-model-claude-3-7'));
    expect(onChange).toHaveBeenLastCalledWith(['claude-3-7']);
  });

  it('marks selected models with aria-pressed', () => {
    render(<ModelMultiSelect models={['gpt-4o']} selected={['gpt-4o']} onChange={() => undefined} />);
    expect(screen.getByTestId('console-filter-model-gpt-4o')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
