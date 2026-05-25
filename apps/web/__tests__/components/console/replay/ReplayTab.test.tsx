// Tests for <ReplayTab /> (LLD Tasks 164-169).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/console-api', () => ({ runReplay: jest.fn() }));
import { runReplay } from '@/lib/console-api';
import { ReplayTab } from '@/components/console/replay/ReplayTab';
import type {
  ProviderAvailabilityResponse,
  ReplayCandidate,
  ReplayDetail,
} from '@argus/contracts';

const mockRunReplay = runReplay as jest.Mock;

const AVAIL: ProviderAvailabilityResponse = {
  providers: [
    { provider: 'openai', available: true, models: [{ model: 'gpt-4o', promptPerMillionUsd: 1, completionPerMillionUsd: 2, priced: true }] },
    { provider: 'mock', available: true, models: [{ model: 'mock-1', promptPerMillionUsd: 0, completionPerMillionUsd: 0, priced: false }] },
  ],
  snapshotDate: '2026-05-01',
};

const CAND: ReplayCandidate = {
  id: 'cand-1',
  conversationId: '22222222-2222-4222-8222-222222222222',
  conversationTitle: 'Convo',
  provider: 'openai',
  model: 'gpt-4o',
  status: 'ok',
  startedAt: '2026-05-25T11:00:00.000Z',
  inputPreview: 'prompt',
  eligibility: 'eligible',
};

const DETAIL: ReplayDetail = {
  id: 'inf-1',
  traceId: 'abcdef0123456789abcdef0123456789',
  conversationId: '22222222-2222-4222-8222-222222222222',
  conversationTitle: 'Convo',
  provider: 'openai',
  model: 'gpt-4o',
  status: 'ok',
  kind: 'chat',
  startedAt: '2026-05-25T11:00:00.000Z',
  endedAt: '2026-05-25T11:00:01.000Z',
  latencyMs: 800,
  promptTokens: 10,
  completionTokens: 20,
  promptCostMicros: 1,
  completionCostMicros: 2,
  totalCostMicros: 3,
  inputPreview: 'prompt',
  outputPreview: 'original output',
  errorCode: null,
  eligibility: 'eligible',
};

beforeEach(() => mockRunReplay.mockReset());

describe('<ReplayTab /> routing (Task 164)', () => {
  it('shows the picker with no source', () => {
    render(<ReplayTab candidates={[CAND]} availability={AVAIL} window="all" />);
    expect(screen.getByTestId('console-replay-picker')).toBeInTheDocument();
    expect(screen.queryByTestId('console-replay-detail')).toBeNull();
  });

  it('shows the detail view when an initial source is provided', () => {
    render(
      <ReplayTab candidates={[CAND]} initialDetail={DETAIL} availability={AVAIL} window="all" />,
    );
    expect(screen.getByTestId('console-replay-detail')).toBeInTheDocument();
    expect(screen.queryByTestId('console-replay-picker')).toBeNull();
  });

  it('transitions to the detail view when a candidate is clicked', async () => {
    render(<ReplayTab candidates={[CAND]} availability={AVAIL} window="all" />);
    await userEvent.click(screen.getByTestId('console-replay-candidate-cand-1'));
    expect(screen.getByTestId('console-replay-detail')).toBeInTheDocument();
  });
});

describe('<ReplayTab /> run lifecycle (Task 166)', () => {
  it('goes idle -> running -> success and mounts the side-by-side pane with the diff', async () => {
    let resolveRun!: (v: unknown) => void;
    mockRunReplay.mockReturnValue(
      new Promise((r) => {
        resolveRun = r;
      }),
    );
    render(<ReplayTab candidates={[]} initialDetail={DETAIL} availability={AVAIL} window="all" />);

    const runButton = screen.getByTestId('console-replay-run-button');
    await userEvent.click(runButton);
    expect(runButton).toBeDisabled(); // running

    await waitFor(() =>
      resolveRun({
        messageId: '33333333-3333-4333-8333-333333333333',
        inferenceId: '44444444-4444-4444-8444-444444444444',
        conversationId: '22222222-2222-4222-8222-222222222222',
        diff: { changes: [{ value: 'same ' }, { value: 'changed', added: true }] },
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('console-replay-side-by-side')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('console-diff-renderer')).toBeInTheDocument();
  });
});

describe('<ReplayTab /> run failure (Task 168)', () => {
  it('transitions to failed and mounts the error message', async () => {
    mockRunReplay.mockRejectedValue(new Error('upstream 500'));
    render(<ReplayTab candidates={[]} initialDetail={DETAIL} availability={AVAIL} window="all" />);
    await userEvent.click(screen.getByTestId('console-replay-run-button'));
    await waitFor(() =>
      expect(screen.getByTestId('console-replay-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('console-replay-error')).toHaveTextContent(/replay failed/i);
  });
});
