// Tests for <TraceDrawer /> (REVIEW-BRIEF Finding 4).
//
// Verifies:
//   - Opens when rendered (appears in DOM)
//   - Renders input/output previews in .codepane
//   - Renders provider/model in the summary kv
//   - Close button calls onClose
//   - Mask click calls onClose
//   - Esc key calls onClose
//   - Replay button navigates to /console/replay?sourceId=...
//   - Replay button absent for canceled / streaming traces
import { render, screen, fireEvent } from '@testing-library/react';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/console/traces',
}));

import { TraceDrawer } from '@/components/console/traces/TraceDrawer';
import type { TraceRow } from '@argus/contracts';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONV = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const baseTrace: TraceRow = {
  id: ID,
  traceId: 'deadbeefdeadbeefdeadbeefdeadbeef',
  conversationId: CONV,
  conversationTitle: 'Test conversation',
  provider: 'anthropic',
  model: 'claude-3-7-sonnet',
  status: 'ok',
  kind: 'chat',
  startedAt: '2026-05-25T10:00:00.000Z',
  endedAt: '2026-05-25T10:00:02.000Z',
  latencyMs: 2000,
  promptTokens: 150,
  completionTokens: 80,
  promptCostMicros: 100,
  completionCostMicros: 200,
  totalCostMicros: 300,
  inputPreview: 'Hello world input',
  outputPreview: 'Hello world output',
  errorCode: null,
};

beforeEach(() => {
  mockPush.mockReset();
});

describe('<TraceDrawer /> render', () => {
  it('appears in the DOM when rendered', () => {
    render(<TraceDrawer trace={baseTrace} onClose={() => undefined} />);
    expect(screen.getByTestId('console-trace-drawer')).toBeInTheDocument();
  });

  it('renders the input preview in the codepane', () => {
    render(<TraceDrawer trace={baseTrace} onClose={() => undefined} />);
    expect(screen.getByTestId('console-trace-drawer-input')).toHaveTextContent('Hello world input');
  });

  it('renders the output preview in the codepane', () => {
    render(<TraceDrawer trace={baseTrace} onClose={() => undefined} />);
    expect(screen.getByTestId('console-trace-drawer-output')).toHaveTextContent('Hello world output');
  });

  it('shows "(no output recorded)" when outputPreview is null', () => {
    render(<TraceDrawer trace={{ ...baseTrace, outputPreview: null }} onClose={() => undefined} />);
    expect(screen.getByTestId('console-trace-drawer-output')).toHaveTextContent('(no output recorded)');
  });

  it('renders provider and model in the summary', () => {
    render(<TraceDrawer trace={baseTrace} onClose={() => undefined} />);
    expect(screen.getByTestId('console-trace-drawer-provider')).toHaveTextContent('anthropic');
    expect(screen.getByTestId('console-trace-drawer-model')).toHaveTextContent('claude-3-7-sonnet');
  });

  it('renders the status pill', () => {
    render(<TraceDrawer trace={baseTrace} onClose={() => undefined} />);
    expect(screen.getByTestId('console-trace-drawer-status')).toHaveTextContent('ok');
  });

  it('renders prompt/completion token counts', () => {
    render(<TraceDrawer trace={baseTrace} onClose={() => undefined} />);
    expect(screen.getByTestId('console-trace-drawer-prompt-tokens')).toHaveTextContent('150');
    expect(screen.getByTestId('console-trace-drawer-completion-tokens')).toHaveTextContent('80');
  });

  it('shows the timeline when latencyMs is present', () => {
    render(<TraceDrawer trace={baseTrace} onClose={() => undefined} />);
    expect(screen.getByTestId('console-trace-drawer-timeline')).toBeInTheDocument();
  });

  it('omits the timeline when latencyMs is null', () => {
    render(<TraceDrawer trace={{ ...baseTrace, latencyMs: null }} onClose={() => undefined} />);
    expect(screen.queryByTestId('console-trace-drawer-timeline')).toBeNull();
  });

  it('shows the error code when present', () => {
    render(
      <TraceDrawer
        trace={{ ...baseTrace, status: 'failed', errorCode: 'RATE_LIMIT' }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId('console-trace-drawer-error')).toHaveTextContent('RATE_LIMIT');
  });
});

describe('<TraceDrawer /> close behaviour', () => {
  it('calls onClose when the close button is clicked', () => {
    const onClose = jest.fn();
    render(<TraceDrawer trace={baseTrace} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('console-trace-drawer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the mask is clicked', () => {
    const onClose = jest.fn();
    render(<TraceDrawer trace={baseTrace} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('console-trace-drawer-mask'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Esc is pressed', () => {
    const onClose = jest.fn();
    render(<TraceDrawer trace={baseTrace} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('<TraceDrawer /> replay button', () => {
  it('shows the replay button for ok traces and navigates to /console/replay', () => {
    render(<TraceDrawer trace={baseTrace} onClose={() => undefined} />);
    const btn = screen.getByTestId('console-trace-drawer-replay');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining(`/console/replay?sourceId=${ID}`),
    );
  });

  it('hides the replay button for canceled traces', () => {
    render(
      <TraceDrawer trace={{ ...baseTrace, status: 'canceled' }} onClose={() => undefined} />,
    );
    expect(screen.queryByTestId('console-trace-drawer-replay')).toBeNull();
  });

  it('hides the replay button for streaming traces', () => {
    render(
      <TraceDrawer trace={{ ...baseTrace, status: 'streaming' }} onClose={() => undefined} />,
    );
    expect(screen.queryByTestId('console-trace-drawer-replay')).toBeNull();
  });
});
