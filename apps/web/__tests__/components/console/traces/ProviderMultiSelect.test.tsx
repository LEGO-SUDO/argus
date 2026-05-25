// Tests for <ProviderMultiSelect /> (LLD Tasks 90-91).
//
// Reskin delta: chips now live in a collapsible dropdown. Tests open the
// trigger before accessing chips. All behavioral assertions are unchanged.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderMultiSelect } from '@/components/console/traces/ProviderMultiSelect';

describe('<ProviderMultiSelect />', () => {
  it('emits the array with the toggled provider added then removed', async () => {
    const onChange = jest.fn();
    const { rerender } = render(<ProviderMultiSelect selected={[]} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('console-filter-provider-trigger'));
    await userEvent.click(screen.getByTestId('console-filter-provider-openai'));
    expect(onChange).toHaveBeenLastCalledWith(['openai']);

    rerender(<ProviderMultiSelect selected={['openai']} onChange={onChange} />);
    // Dropdown stays open after rerender (open state is local)
    await userEvent.click(screen.getByTestId('console-filter-provider-openai'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('announces selected chips via aria-pressed', async () => {
    render(<ProviderMultiSelect selected={['anthropic']} onChange={() => undefined} />);
    await userEvent.click(screen.getByTestId('console-filter-provider-trigger'));
    expect(screen.getByTestId('console-filter-provider-anthropic')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('console-filter-provider-openai')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
