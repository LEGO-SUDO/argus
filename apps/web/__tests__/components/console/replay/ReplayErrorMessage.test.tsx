// Tests for <ReplayErrorMessage /> (LLD Tasks 158-159).
import { render, screen } from '@testing-library/react';
import { ReplayErrorMessage } from '@/components/console/replay/ReplayErrorMessage';

describe('<ReplayErrorMessage />', () => {
  it('renders the original-canceled copy', () => {
    render(<ReplayErrorMessage kind="original_canceled" />);
    expect(screen.getByTestId('console-replay-error')).toHaveTextContent(/no output to compare/i);
  });

  it('embeds the cause in the replay-failed copy', () => {
    render(<ReplayErrorMessage kind="replay_failed" cause="rate limited" />);
    expect(screen.getByTestId('console-replay-error')).toHaveTextContent(/replay failed: rate limited/i);
  });

  it('renders the generic both-failed copy', () => {
    render(<ReplayErrorMessage kind="both_failed" />);
    expect(screen.getByTestId('console-replay-error')).toHaveTextContent(/both .* failed/i);
  });
});
