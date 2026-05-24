// OmittedIndicator — visibility threshold test (LLD Task 17).
import { render, screen } from '@testing-library/react';
import { OmittedIndicator } from '@/components/chat/OmittedIndicator';

describe('OmittedIndicator', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<OmittedIndicator count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the count message when count > 0', () => {
    render(<OmittedIndicator count={3} />);
    expect(screen.getByText(/3 earlier messages omitted/i)).toBeInTheDocument();
  });
});
