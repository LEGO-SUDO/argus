// useFocusComposer — unit tests for the composer auto-focus hook.
//
// LLD Block C (Tasks 47-56). The hook focuses a ref'd textarea on:
//   - mount
//   - the falling edge of the streaming lock (true → false)
//   - every conversationId change
// and crucially does NOT steal focus mid-stream or on arbitrary re-renders.
//
// We mount a tiny host component via RTL so React effect ordering matches
// production. jsdom implements focus()/document.activeElement faithfully for
// elements attached to the document.

import { render } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusComposer } from '@/lib/use-focus-composer';

const CONV_A = '11111111-1111-4111-8111-111111111111';
const CONV_B = '22222222-2222-4222-8222-222222222222';

type HostProps = {
  streaming?: boolean;
  disabled?: boolean;
  conversationId?: string | null;
};

// Host renders the textarea + a sibling button so tests can move focus away
// and assert the hook does (or does not) yank it back.
function Host({ streaming = false, disabled = false, conversationId = null }: HostProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useFocusComposer({ ref, streaming, disabled, conversationId });
  return (
    <div>
      <textarea ref={ref} data-testid="ta" />
      <button type="button" data-testid="sibling">
        sibling
      </button>
    </div>
  );
}

describe('useFocusComposer', () => {
  // Task 47-48
  it('focuses the textarea on mount', () => {
    const { getByTestId } = render(<Host />);
    expect(document.activeElement).toBe(getByTestId('ta'));
  });

  // Task 49-50
  it('re-focuses after the streaming lock releases (true → false)', () => {
    const { getByTestId, rerender } = render(<Host streaming />);
    // While streaming, move focus to the sibling.
    (getByTestId('sibling') as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(getByTestId('sibling'));
    // Lock releases.
    rerender(<Host streaming={false} />);
    expect(document.activeElement).toBe(getByTestId('ta'));
  });

  // Task 51-52
  it('focuses on conversationId change', () => {
    const { getByTestId, rerender } = render(<Host conversationId={null} />);
    (getByTestId('sibling') as HTMLButtonElement).focus();
    rerender(<Host conversationId={CONV_A} />);
    expect(document.activeElement).toBe(getByTestId('ta'));

    // Move away then change id again.
    (getByTestId('sibling') as HTMLButtonElement).focus();
    rerender(<Host conversationId={CONV_B} />);
    expect(document.activeElement).toBe(getByTestId('ta'));
  });

  // Task 53-54
  it('does NOT steal focus mid-stream', () => {
    const { getByTestId, rerender } = render(<Host streaming={false} />);
    // Mount focus lands on the textarea; move to the sibling and start a
    // stream.
    (getByTestId('sibling') as HTMLButtonElement).focus();
    rerender(<Host streaming />);
    // Focus must stay on the sibling — the stream is in flight.
    expect(document.activeElement).toBe(getByTestId('sibling'));
    // A further re-render while still streaming must not yank focus back.
    rerender(<Host streaming />);
    expect(document.activeElement).toBe(getByTestId('sibling'));
  });

  // Task 55-56
  it('does not refocus on an idle re-render (no lock release, no id change)', () => {
    const { getByTestId, rerender } = render(<Host conversationId={CONV_A} />);
    // Click a sibling while idle.
    (getByTestId('sibling') as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(getByTestId('sibling'));
    // Re-render with identical props — focus must stay on the sibling.
    rerender(<Host conversationId={CONV_A} />);
    expect(document.activeElement).toBe(getByTestId('sibling'));
  });
});
