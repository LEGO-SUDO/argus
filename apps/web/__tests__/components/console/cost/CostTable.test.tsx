// Tests for <CostTable /> (LLD Tasks 136-143).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CostTable } from '@/components/console/cost/CostTable';
import type { CostGroup } from '@argus/contracts';

const group = (over: Partial<CostGroup>): CostGroup => ({
  key: 'k',
  label: 'gpt-4o',
  promptCostMicros: 1_000_000,
  completionCostMicros: 2_000_000,
  totalCostMicros: 3_000_000,
  unpricedCount: 0,
  ...over,
});

describe('<CostTable /> standard render (Task 136)', () => {
  it('renders grouped rows with prompt/completion/total columns', () => {
    render(
      <CostTable
        groups={[group({ key: 'a', label: 'gpt-4o' }), group({ key: 'b', label: 'claude' })]}
        unpricedModels={[]}
        onDrilldown={() => undefined}
      />,
    );
    const row = screen.getByTestId('console-cost-row-a');
    expect(row).toHaveTextContent('gpt-4o');
    expect(row).toHaveTextContent('$1.00');
    expect(row).toHaveTextContent('$2.00');
    expect(row).toHaveTextContent('$3.00');
    expect(screen.getByTestId('console-cost-row-b')).toBeInTheDocument();
  });
});

describe('<CostTable /> unpriced badge (Task 138)', () => {
  it('mounts the unpriced badge for groups with unpriced rows', () => {
    render(
      <CostTable
        groups={[group({ key: 'a', unpricedCount: 3 }), group({ key: 'b', unpricedCount: 0 })]}
        unpricedModels={['mystery']}
        onDrilldown={() => undefined}
      />,
    );
    const rowA = screen.getByTestId('console-cost-row-a');
    const rowB = screen.getByTestId('console-cost-row-b');
    expect(rowA.querySelector('[data-testid="console-unpriced-badge"]')).not.toBeNull();
    expect(rowB.querySelector('[data-testid="console-unpriced-badge"]')).toBeNull();
  });
});

describe('<CostTable /> mock rows (Task 140)', () => {
  it('marks mock-provider rows with annotation + data attribute', () => {
    render(
      <CostTable
        groups={[group({ key: 'mock', label: 'mock' })]}
        unpricedModels={[]}
        onDrilldown={() => undefined}
      />,
    );
    const row = screen.getByTestId('console-cost-row-mock');
    expect(row).toHaveAttribute('data-mock', 'true');
    expect(screen.getByTestId('console-cost-row-mock-mock')).toHaveTextContent(/mock provider/i);
  });
});

describe('<CostTable /> drilldown (Task 142)', () => {
  it('invokes the drilldown handler with the clicked group', async () => {
    const onDrilldown = jest.fn();
    const g = group({ key: 'a' });
    render(<CostTable groups={[g]} unpricedModels={[]} onDrilldown={onDrilldown} />);
    await userEvent.click(screen.getByTestId('console-cost-row-a-select'));
    expect(onDrilldown).toHaveBeenCalledWith(g);
  });
});
