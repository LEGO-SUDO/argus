// Tests for <UnpricedBadge /> (LLD Tasks 134-135).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnpricedBadge } from '@/components/console/cost/UnpricedBadge';

describe('<UnpricedBadge />', () => {
  it('shows the count and expands the model list on click', async () => {
    render(<UnpricedBadge count={2} models={['mystery-model', 'old-model']} />);
    const badge = screen.getByTestId('console-unpriced-badge');
    expect(badge).toHaveTextContent('2');
    expect(screen.queryByTestId('console-unpriced-badge-popover')).toBeNull();
    await userEvent.click(badge);
    const popover = screen.getByTestId('console-unpriced-badge-popover');
    expect(popover).toHaveTextContent('mystery-model');
    expect(popover).toHaveTextContent('old-model');
  });

  it('renders nothing when the count is zero', () => {
    const { container } = render(<UnpricedBadge count={0} models={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
