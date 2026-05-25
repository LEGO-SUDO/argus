// Tests for <TraceRow /> (LLD Tasks 106-113).
//
// Reskin delta: TraceRow now renders a <tr> (table row) for the .con-table.
// Tests wrap the render in <table><tbody> for valid HTML. All behavioral
// assertions — testids, aria, Jaeger link, conversation link, replay badge,
// token counts, expand toggle — are preserved unchanged.
import { render, screen } from '@testing-library/react';
import { TraceRow } from '@/components/console/traces/TraceRow';
import type { TraceRow as TraceRowDto } from '@argus/contracts';

const ID = '11111111-1111-4111-8111-111111111111';
const CONV = '22222222-2222-4222-8222-222222222222';
const TRACE_ID = 'abcdef0123456789abcdef0123456789';

const baseRow: TraceRowDto = {
  id: ID,
  traceId: TRACE_ID,
  conversationId: CONV,
  conversationTitle: 'My conversation',
  provider: 'openai',
  model: 'gpt-4o',
  status: 'ok',
  kind: 'chat',
  startedAt: '2026-05-25T12:00:00.000Z',
  endedAt: '2026-05-25T12:00:01.000Z',
  latencyMs: 1200,
  promptTokens: 100,
  completionTokens: 50,
  promptCostMicros: 1,
  completionCostMicros: 2,
  totalCostMicros: 3,
  inputPreview: 'hi',
  outputPreview: 'yo',
  errorCode: null,
};

/** Render TraceRow inside a valid <table><tbody> wrapper. */
function renderRow(props: Partial<React.ComponentProps<typeof TraceRow>> = {}) {
  return render(
    <table>
      <tbody>
        <TraceRow row={baseRow} {...props} />
      </tbody>
    </table>,
  );
}

describe('<TraceRow /> standard render (Task 106)', () => {
  it('renders cells, the conversation link, and an exact Jaeger deep link in a new tab', () => {
    renderRow();
    expect(screen.getByTestId(`console-trace-row-${ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`console-trace-row-${ID}-status`)).toHaveTextContent('ok');
    const convoLink = screen.getByTestId(`console-trace-row-${ID}-conversation-link`);
    expect(convoLink).toHaveAttribute('href', `/console/traces?conversationId=${CONV}`);
    const jaeger = screen.getByTestId(`console-trace-row-${ID}-jaeger-link`);
    // R3: the Jaeger deep link is built from the OTel traceId, not the row id.
    expect(jaeger).toHaveAttribute('href', `http://localhost:16686/trace/${TRACE_ID}`);
    expect(jaeger).toHaveAttribute('target', '_blank');
    expect(jaeger).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('omits the Jaeger link when the row has no trace id yet', () => {
    renderRow({ row: { ...baseRow, traceId: '' } });
    expect(screen.queryByTestId(`console-trace-row-${ID}-jaeger-link`)).toBeNull();
  });
});

describe('<TraceRow /> deleted conversation (Task 108)', () => {
  it('appends "(deleted)" and keeps the link clickable', () => {
    renderRow({ conversationDeleted: true });
    const convoLink = screen.getByTestId(`console-trace-row-${ID}-conversation-link`);
    expect(convoLink).toHaveTextContent('(deleted)');
    expect(convoLink).toHaveAttribute('href', `/console/traces?conversationId=${CONV}`);
  });
});

describe('<TraceRow /> replay badge (Task 110)', () => {
  it('shows the replay badge only when kind is replay', () => {
    const { rerender } = render(
      <table>
        <tbody>
          <TraceRow row={{ ...baseRow, kind: 'replay' }} />
        </tbody>
      </table>,
    );
    expect(screen.getByTestId(`console-trace-row-${ID}-replay-badge`)).toBeInTheDocument();
    rerender(
      <table>
        <tbody>
          <TraceRow row={{ ...baseRow, kind: 'chat' }} />
        </tbody>
      </table>,
    );
    expect(screen.queryByTestId(`console-trace-row-${ID}-replay-badge`)).toBeNull();
  });
});

describe('<TraceRow /> null tokens (Task 112)', () => {
  it('renders em-dash when both token counts are null', () => {
    renderRow({ row: { ...baseRow, promptTokens: null, completionTokens: null } });
    expect(screen.getByTestId(`console-trace-row-${ID}-prompt-tokens`)).toHaveTextContent('—');
    expect(screen.getByTestId(`console-trace-row-${ID}-completion-tokens`)).toHaveTextContent('—');
  });
});
