// Tests for <DiffRenderer /> (LLD Tasks 160-163).
import { render, screen } from '@testing-library/react';
import { DiffRenderer } from '@/components/console/replay/DiffRenderer';

describe('<DiffRenderer /> (Task 160)', () => {
  it('renders added/removed/unchanged segments as spans with diff attributes', () => {
    render(
      <DiffRenderer
        changes={[
          { value: 'shared ' },
          { value: 'new', added: true },
          { value: 'old', removed: true },
        ]}
      />,
    );
    const container = screen.getByTestId('console-diff-renderer');
    const spans = container.querySelectorAll('span');
    expect(spans).toHaveLength(3);
    expect(container.querySelector('[data-diff="added"]')).toHaveTextContent('new');
    expect(container.querySelector('[data-diff="unchanged"]')).toHaveTextContent('shared');
  });
});

describe('<DiffRenderer /> removed + empty (Task 162)', () => {
  it('renders removed segments with the removed indicator', () => {
    render(<DiffRenderer changes={[{ value: 'gone', removed: true }]} />);
    expect(
      screen.getByTestId('console-diff-renderer').querySelector('[data-diff="removed"]'),
    ).toHaveTextContent('gone');
  });

  it('renders an empty container for an empty payload', () => {
    render(<DiffRenderer changes={[]} />);
    const container = screen.getByTestId('console-diff-renderer');
    expect(container).toBeInTheDocument();
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });
});
