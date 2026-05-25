// Tests for <ReplayPicker /> (LLD Tasks 150-153).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplayPicker } from '@/components/console/replay/ReplayPicker';
import type { ReplayCandidate } from '@argus/contracts';

const NOW = Date.parse('2026-05-25T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600 * 1000).toISOString();

const candidate = (over: Partial<ReplayCandidate>): ReplayCandidate => ({
  id: 'cand',
  conversationId: '22222222-2222-4222-8222-222222222222',
  conversationTitle: 'Convo',
  provider: 'openai',
  model: 'gpt-4o',
  status: 'ok',
  startedAt: hoursAgo(1),
  inputPreview: 'prompt',
  eligibility: 'eligible',
  ...over,
});

describe('<ReplayPicker /> render (Task 150)', () => {
  it('renders one entry per candidate with a status label; canceled shows a warning', async () => {
    const onSelect = jest.fn();
    const candidates = [
      candidate({ id: 'a', status: 'ok' }),
      candidate({ id: 'b', status: 'failed' }),
      candidate({ id: 'c', status: 'timed_out' }),
      candidate({ id: 'd', status: 'canceled' }),
    ];
    render(<ReplayPicker candidates={candidates} window="all" onSelect={onSelect} now={NOW} />);
    expect(screen.getByTestId('console-replay-candidate-a-status')).toHaveTextContent('ok');
    expect(screen.getByTestId('console-replay-candidate-d-warning')).toHaveTextContent(
      /partial input only/i,
    );
    await userEvent.click(screen.getByTestId('console-replay-candidate-b'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });
});

describe('<ReplayPicker /> window filter (Task 152)', () => {
  it('excludes candidates older than the window cutoff; all includes everything', () => {
    const candidates = [
      candidate({ id: 'recent', startedAt: hoursAgo(2) }),
      candidate({ id: 'old', startedAt: hoursAgo(48) }),
    ];
    const { rerender } = render(
      <ReplayPicker candidates={candidates} window="24h" onSelect={() => undefined} now={NOW} />,
    );
    expect(screen.getByTestId('console-replay-candidate-recent')).toBeInTheDocument();
    expect(screen.queryByTestId('console-replay-candidate-old')).toBeNull();

    rerender(
      <ReplayPicker candidates={candidates} window="all" onSelect={() => undefined} now={NOW} />,
    );
    expect(screen.getByTestId('console-replay-candidate-old')).toBeInTheDocument();
  });
});
