// ConversationList grouping — Today / Yesterday / Earlier buckets driven
// by `lastMessageAt` vs the system clock.
//
// The bucket boundaries (18h, 42h) mirror the design source
// (`docs/design/project/chat.jsx` lines 45-55). We freeze the clock so the
// test is deterministic and exercise each bucket.
import { render, screen } from '@testing-library/react';
import { ConversationList } from '@/components/chat/ConversationList';
import type { ConversationDto } from '@argus/contracts';

function isoMinusHours(now: number, h: number): string {
  return new Date(now - h * 60 * 60 * 1000).toISOString();
}

function makeConv(id: string, title: string, lastMessageAt: string): ConversationDto {
  return {
    id,
    title,
    createdAt: lastMessageAt,
    lastMessageAt,
  };
}

describe('ConversationList — Today / Yesterday / Earlier groups', () => {
  // Pin Date.now to a stable instant so the bucket boundaries are
  // reproducible across CI vs local clocks.
  const FROZEN_NOW = Date.UTC(2026, 4, 24, 12, 0, 0); // 2026-05-24 12:00 UTC
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(FROZEN_NOW));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('buckets conversations into today / yesterday / earlier by lastMessageAt', () => {
    const convs: ConversationDto[] = [
      makeConv('11111111-1111-4111-8111-aaaaaaaaaaaa', 'Today thread', isoMinusHours(FROZEN_NOW, 2)),
      makeConv('22222222-2222-4222-8222-bbbbbbbbbbbb', 'Yesterday thread', isoMinusHours(FROZEN_NOW, 30)),
      makeConv('33333333-3333-4333-8333-cccccccccccc', 'Earlier thread', isoMinusHours(FROZEN_NOW, 96)),
    ];
    render(<ConversationList conversations={convs} activeId={null} />);

    // Each group only renders when it has items, so all three labels must
    // be present here.
    expect(screen.getByTestId('conversation-group-label-today')).toHaveTextContent(/today/i);
    expect(screen.getByTestId('conversation-group-label-yesterday')).toHaveTextContent(/yesterday/i);
    expect(screen.getByTestId('conversation-group-label-earlier')).toHaveTextContent(/earlier/i);

    // Each conversation is in exactly its expected group's subtree.
    const todayGroup = screen.getByTestId('conversation-group-today');
    expect(todayGroup).toHaveTextContent('Today thread');
    expect(todayGroup).not.toHaveTextContent('Yesterday thread');
    expect(todayGroup).not.toHaveTextContent('Earlier thread');

    const yesterdayGroup = screen.getByTestId('conversation-group-yesterday');
    expect(yesterdayGroup).toHaveTextContent('Yesterday thread');

    const earlierGroup = screen.getByTestId('conversation-group-earlier');
    expect(earlierGroup).toHaveTextContent('Earlier thread');
  });

  it('omits groups that have no conversations', () => {
    const convs: ConversationDto[] = [
      makeConv('11111111-1111-4111-8111-aaaaaaaaaaaa', 'Only today', isoMinusHours(FROZEN_NOW, 1)),
    ];
    render(<ConversationList conversations={convs} activeId={null} />);
    expect(screen.queryByTestId('conversation-group-yesterday')).toBeNull();
    expect(screen.queryByTestId('conversation-group-earlier')).toBeNull();
    expect(screen.getByTestId('conversation-group-today')).toBeInTheDocument();
  });

  it('marks the active conversation with aria-current="page" and the active bg class', () => {
    const convs: ConversationDto[] = [
      makeConv('11111111-1111-4111-8111-aaaaaaaaaaaa', 'Alpha', isoMinusHours(FROZEN_NOW, 1)),
      makeConv('22222222-2222-4222-8222-bbbbbbbbbbbb', 'Beta', isoMinusHours(FROZEN_NOW, 1)),
    ];
    const activeId = convs[1]!.id;
    render(<ConversationList conversations={convs} activeId={activeId} />);
    const active = screen.getByRole('link', { name: 'Beta' });
    expect(active).toHaveAttribute('aria-current', 'page');
    // The design specifies bg-chat-hover for the active state (NOT bg-acc-soft).
    // Match the standalone token (not the `hover:bg-chat-hover` prefix used
    // for non-active rows).
    expect(active.className).toMatch(/(^| )bg-chat-hover( |$)/);
    // The active row must NOT carry the acc-soft tint the previous build used.
    expect(active.className).not.toMatch(/bg-acc-soft/);
    const inactive = screen.getByRole('link', { name: 'Alpha' });
    expect(inactive).not.toHaveAttribute('aria-current');
    // Inactive rows only get hover:bg-chat-hover (prefixed), never the
    // standalone class — that one is reserved for the active state.
    expect(inactive.className).not.toMatch(/(^| )bg-chat-hover( |$)/);
  });
});
