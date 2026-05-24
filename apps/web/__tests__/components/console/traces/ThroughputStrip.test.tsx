// Tests for <ThroughputStrip /> (LLD Tasks 88-89).
import { render, screen } from '@testing-library/react';
import { ThroughputStrip } from '@/components/console/traces/ThroughputStrip';

describe('<ThroughputStrip />', () => {
  it('renders turns/hour, locale-formatted tokens/hour, and the error rate %', () => {
    render(
      <ThroughputStrip throughput={{ turnsPerHour: 42, tokensPerHour: 12345, errorRate: 0.25 }} />,
    );
    expect(screen.getByTestId('console-throughput-turns')).toHaveTextContent('42');
    expect(screen.getByTestId('console-throughput-tokens')).toHaveTextContent('12,345');
    expect(screen.getByTestId('console-throughput-error-rate')).toHaveTextContent('25.0%');
  });
});
