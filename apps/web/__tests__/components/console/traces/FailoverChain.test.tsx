// Tests for <FailoverChain /> (LLD Tasks 114-117).
import { render, screen } from '@testing-library/react';
import { FailoverChain, type FailoverAttempt } from '@/components/console/traces/FailoverChain';

const failed: FailoverAttempt = { provider: 'openai', model: 'gpt-4o', status: 'failed', errorCode: 'rate_limit' };
const ok: FailoverAttempt = { provider: 'anthropic', model: 'claude-3-7', status: 'ok' };

describe('<FailoverChain /> render (Task 114)', () => {
  it('renders one row per attempt in order, with the preview above', () => {
    render(<FailoverChain attempts={[failed, ok]} userMessagePreview="why is the sky blue?" />);
    expect(screen.getByTestId('console-failover-chain-preview')).toHaveTextContent('why is the sky blue?');
    expect(screen.getByTestId('console-failover-attempt-0')).toHaveTextContent('openai');
    expect(screen.getByTestId('console-failover-attempt-1')).toHaveTextContent('anthropic');
  });
});

describe('<FailoverChain /> summary (Task 116)', () => {
  it('summarizes a successful failover as "succeeded after N retries"', () => {
    render(<FailoverChain attempts={[failed, ok]} />);
    expect(screen.getByTestId('console-failover-chain-summary')).toHaveTextContent(
      /succeeded after 1 retry/i,
    );
  });

  it('summarizes an all-failed chain', () => {
    render(<FailoverChain attempts={[failed, { ...failed, provider: 'gemini' }]} />);
    expect(screen.getByTestId('console-failover-chain-summary')).toHaveTextContent(
      /all attempts failed/i,
    );
  });
});
