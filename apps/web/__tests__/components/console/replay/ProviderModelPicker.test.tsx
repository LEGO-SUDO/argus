// Tests for <ProviderModelPicker /> (LLD Tasks 154-157).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderModelPicker } from '@/components/console/replay/ProviderModelPicker';
import type { ProviderAvailabilityResponse } from '@argus/contracts';

const AVAIL: ProviderAvailabilityResponse = {
  providers: [
    {
      provider: 'openai',
      available: true,
      models: [
        { model: 'gpt-4o', promptPerMillionUsd: 2.5, completionPerMillionUsd: 10, priced: true },
      ],
    },
    {
      provider: 'anthropic',
      available: false,
      models: [
        { model: 'claude-3-7', promptPerMillionUsd: 3, completionPerMillionUsd: 15, priced: true },
      ],
    },
    { provider: 'mock', available: true, models: [{ model: 'mock-1', promptPerMillionUsd: 0, completionPerMillionUsd: 0, priced: false }] },
  ],
  snapshotDate: '2026-05-01',
};

describe('<ProviderModelPicker /> availability gating (Task 154)', () => {
  it('disables unavailable providers with a tooltip and a switch-to-Mock CTA', () => {
    render(
      <ProviderModelPicker availability={AVAIL} provider="openai" model="gpt-4o" onChange={() => undefined} />,
    );
    const anthropic = screen.getByTestId('console-replay-provider-anthropic');
    expect(anthropic).toHaveAttribute('aria-disabled', 'true');
    expect(anthropic).toHaveAttribute('title', 'key not configured');
    expect(screen.getByTestId('console-replay-switch-mock-anthropic')).toBeInTheDocument();
  });

  it('switch-to-Mock CTA selects the mock provider + its first model', async () => {
    const onChange = jest.fn();
    render(
      <ProviderModelPicker availability={AVAIL} provider="openai" model="gpt-4o" onChange={onChange} />,
    );
    await userEvent.click(screen.getByTestId('console-replay-switch-mock-anthropic'));
    expect(onChange).toHaveBeenCalledWith('mock', 'mock-1');
  });
});

describe('<ProviderModelPicker /> model catalog (Task 156)', () => {
  it('keys the model dropdown off the availability catalog and updates on provider switch', () => {
    const { rerender } = render(
      <ProviderModelPicker availability={AVAIL} provider="openai" model="gpt-4o" onChange={() => undefined} />,
    );
    const select = screen.getByTestId('console-replay-model-select');
    expect(within(select).getByText('gpt-4o')).toBeInTheDocument();
    expect(within(select).queryByText('mock-1')).toBeNull();

    rerender(
      <ProviderModelPicker availability={AVAIL} provider="mock" model="mock-1" onChange={() => undefined} />,
    );
    expect(within(select).getByText(/mock-1/)).toBeInTheDocument();
    expect(within(select).queryByText('gpt-4o')).toBeNull();
  });
});
