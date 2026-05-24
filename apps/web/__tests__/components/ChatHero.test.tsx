// ChatHero — the empty-state surface for /chat with no active conversation.
//
// Verifies:
//   - The container is exposed via `data-testid="chat-empty-hero"` (the
//     e2e suite targets this exact testid)
//   - Eyebrow + Instrument Serif heading + intro paragraph render
//   - Four starter cards render and clicking one invokes the onPickStarter
//     handler with the combined "<title> <sub>" text (matches the design
//     source's pre-fill flow)
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatHero } from '@/components/chat/ChatHero';

describe('ChatHero', () => {
  it('renders the testid the e2e suite targets', () => {
    render(<ChatHero onPickStarter={() => undefined} />);
    expect(screen.getByTestId('chat-empty-hero')).toBeInTheDocument();
  });

  it('renders the eyebrow + heading + intro copy', () => {
    render(<ChatHero onPickStarter={() => undefined} />);
    expect(screen.getByText(/argus · mock provider on/i)).toBeInTheDocument();
    // The heading contains an italic <em> in the middle so we grep for the
    // surrounding fragments rather than the whole string.
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/how can i.*help.*today/i);
  });

  it('renders exactly four starter cards in the grid', () => {
    render(<ChatHero onPickStarter={() => undefined} />);
    const grid = screen.getByTestId('chat-empty-hero-starters');
    // Each starter is a <button> with aria-label="Use starter: <title>".
    const starters = grid.querySelectorAll('button[aria-label^="Use starter"]');
    expect(starters).toHaveLength(4);
  });

  it('invokes onPickStarter with the combined title + sub on click', async () => {
    const onPick = jest.fn();
    render(<ChatHero onPickStarter={onPick} />);
    // Pick the first starter — "Help me draft a reply"
    const first = screen.getByRole('button', {
      name: /use starter: help me draft a reply/i,
    });
    await userEvent.click(first);
    expect(onPick).toHaveBeenCalledTimes(1);
    // The handler receives "<title> <sub>" — the parent uses this verbatim
    // as the composer pre-fill text.
    expect(onPick.mock.calls[0]![0]).toMatch(/help me draft a reply.*refund/i);
  });
});
