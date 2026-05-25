// Tests for <EmptyState /> (LLD Tasks 70-71).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from '@/components/console/EmptyState';

describe('<EmptyState />', () => {
  for (const scope of ['traces', 'cost', 'replay'] as const) {
    it(`renders distinct copy + chat link + generate CTA for the ${scope} scope`, () => {
      const onGenerateSamples = jest.fn();
      render(<EmptyState scope={scope} onGenerateSamples={onGenerateSamples} />);
      expect(screen.getByTestId(`console-empty-state-${scope}`)).toBeInTheDocument();
      const link = screen.getByTestId(`console-empty-state-${scope}-chat-link`);
      expect(link).toHaveAttribute('href', '/chat');
      expect(screen.getByTestId(`console-empty-state-${scope}-generate-cta`)).toBeInTheDocument();
    });
  }

  it('renders unique titles per scope', () => {
    const { rerender } = render(<EmptyState scope="traces" />);
    const traces = screen.getByTestId('console-empty-state-traces').textContent;
    rerender(<EmptyState scope="cost" />);
    const cost = screen.getByTestId('console-empty-state-cost').textContent;
    expect(traces).not.toEqual(cost);
  });

  it('fires onGenerateSamples when the CTA is clicked', async () => {
    const onGenerateSamples = jest.fn();
    render(<EmptyState scope="traces" onGenerateSamples={onGenerateSamples} />);
    await userEvent.click(screen.getByTestId('console-empty-state-traces-generate-cta'));
    expect(onGenerateSamples).toHaveBeenCalledTimes(1);
  });
});
