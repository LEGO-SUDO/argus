// Tests for <ProviderMultiSelect /> (LLD Tasks 90-91).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderMultiSelect } from '@/components/console/traces/ProviderMultiSelect';

describe('<ProviderMultiSelect />', () => {
  it('emits the array with the toggled provider added then removed', async () => {
    const onChange = jest.fn();
    const { rerender } = render(<ProviderMultiSelect selected={[]} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('console-filter-provider-openai'));
    expect(onChange).toHaveBeenLastCalledWith(['openai']);

    rerender(<ProviderMultiSelect selected={['openai']} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('console-filter-provider-openai'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('announces selected chips via aria-pressed', () => {
    render(<ProviderMultiSelect selected={['anthropic']} onChange={() => undefined} />);
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
