// ConversationList — empty state + populated active-highlight tests
// (LLD Tasks 19 + 21).
//
// Tests against a stable contract: the component takes a `conversations`
// array and an `activeId` and renders either an empty-state CTA or a list
// of links with `aria-current="page"` on the active row.
import { render, screen } from '@testing-library/react';
import { ConversationList } from '@/components/chat/ConversationList';
import type { ConversationDto } from '@argus/contracts';

function makeConv(id: string, title: string): ConversationDto {
  return {
    id,
    title,
    createdAt: '2026-05-23T00:00:00.000Z',
    lastMessageAt: '2026-05-23T00:00:00.000Z',
  };
}

describe('ConversationList', () => {
  describe('empty state', () => {
    it('renders the empty copy and a link to start a new chat', () => {
      render(<ConversationList conversations={[]} activeId={null} />);
      expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
      const startLink = screen.getByRole('link', { name: /start a new chat/i });
      expect(startLink).toHaveAttribute('href', '/chat');
    });
  });

  describe('populated state', () => {
    const convs: ConversationDto[] = [
      makeConv('11111111-1111-4111-8111-aaaaaaaaaaaa', 'Alpha thread'),
      makeConv('22222222-2222-4222-8222-bbbbbbbbbbbb', 'Beta thread'),
      makeConv('33333333-3333-4333-8333-cccccccccccc', 'Gamma thread'),
    ];

    it('renders one link per conversation pointing at /chat/<id>', () => {
      render(<ConversationList conversations={convs} activeId={null} />);
      for (const c of convs) {
        const link = screen.getByRole('link', { name: c.title });
        expect(link).toHaveAttribute('href', `/chat/${c.id}`);
      }
    });

    it('marks the active conversation with aria-current="page"', () => {
      const activeId = convs[1]!.id;
      render(<ConversationList conversations={convs} activeId={activeId} />);
      const activeLink = screen.getByRole('link', { name: convs[1]!.title });
      expect(activeLink).toHaveAttribute('aria-current', 'page');
      // Other rows are not marked active.
      expect(screen.getByRole('link', { name: convs[0]!.title })).not.toHaveAttribute(
        'aria-current',
      );
      expect(screen.getByRole('link', { name: convs[2]!.title })).not.toHaveAttribute(
        'aria-current',
      );
    });
  });
});
