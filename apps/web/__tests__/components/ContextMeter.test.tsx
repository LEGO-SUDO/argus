// ContextMeter — presentational token-usage meter (LLD Block F, Tasks
// 92-95). Renders the PRD fraction "8.2k / 10k tokens" when both fields are
// present; renders nothing when budget is 0 or tokensUsed is null/undefined.

import { render, screen } from '@testing-library/react';
import { ContextMeter } from '@/components/chat/ContextMeter';

describe('ContextMeter', () => {
  // Task 92-93
  it('renders the fraction with the unit when both fields are present', () => {
    render(<ContextMeter tokensUsed={8200} tokensBudget={10000} />);
    const meter = screen.getByTestId('context-meter');
    expect(meter).toHaveTextContent('8.2k / 10k tokens');
  });

  it('formats sub-1000 values without the k suffix', () => {
    render(<ContextMeter tokensUsed={512} tokensBudget={4096} />);
    expect(screen.getByTestId('context-meter')).toHaveTextContent(
      '512 / 4.1k tokens',
    );
  });

  // Task 94-95 — guards
  it('renders nothing when budget is 0', () => {
    const { container } = render(
      <ContextMeter tokensUsed={100} tokensBudget={0} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('context-meter')).toBeNull();
  });

  it('renders nothing when tokensUsed is null', () => {
    const { container } = render(
      <ContextMeter tokensUsed={null} tokensBudget={10000} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when tokensUsed is undefined', () => {
    const { container } = render(
      <ContextMeter tokensUsed={undefined} tokensBudget={10000} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when tokensBudget is null/undefined', () => {
    const { container, rerender } = render(
      <ContextMeter tokensUsed={100} tokensBudget={null} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<ContextMeter tokensUsed={100} tokensBudget={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
