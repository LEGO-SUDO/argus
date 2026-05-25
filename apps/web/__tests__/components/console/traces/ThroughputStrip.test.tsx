// Tests for <ThroughputStrip /> (LLD Tasks 88-89).
//
// Reskin delta: the stat strip now shows inferences (turnsPerHour), latency
// p50/p95, and error rate instead of the previous turns/tokens/error layout.
// The `console-throughput-turns` and `console-throughput-error-rate` testids
// are preserved; `console-throughput-tokens` is replaced by `console-throughput-p50`
// and `console-throughput-p95`. Tests updated to reflect the new layout while
// keeping all behavioral assertions intact.
import { render, screen } from '@testing-library/react';
import { ThroughputStrip } from '@/components/console/traces/ThroughputStrip';

describe('<ThroughputStrip />', () => {
  it('renders turns/hour, error rate %, and SLO delta — without optional latency', () => {
    render(
      <ThroughputStrip throughput={{ turnsPerHour: 42, tokensPerHour: 12345, errorRate: 0.25 }} />,
    );
    expect(screen.getByTestId('console-throughput-turns')).toHaveTextContent('42');
    expect(screen.getByTestId('console-throughput-error-rate')).toHaveTextContent('25.0%');
    // Above SLO (5%) → "above SLO" delta text
    expect(screen.getByText(/above SLO/i)).toBeInTheDocument();
    // p50 / p95 show em-dash when not supplied
    expect(screen.getByTestId('console-throughput-p50')).toHaveTextContent('—');
    expect(screen.getByTestId('console-throughput-p95')).toHaveTextContent('—');
  });

  it('renders p50 and p95 latency when supplied', () => {
    render(
      <ThroughputStrip
        throughput={{ turnsPerHour: 10, tokensPerHour: 5000, errorRate: 0.01 }}
        latencyP50={320}
        latencyP95={780}
      />,
    );
    expect(screen.getByTestId('console-throughput-p50')).toHaveTextContent('320');
    expect(screen.getByTestId('console-throughput-p95')).toHaveTextContent('780');
    // Within SLO
    expect(screen.getByText(/within SLO/i)).toBeInTheDocument();
  });
});
