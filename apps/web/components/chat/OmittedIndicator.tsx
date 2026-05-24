// OmittedIndicator — surfaces HLD D6's "N earlier messages omitted from
// context" hint above the message list when the SDK context builder dropped
// messages to stay under the token cap.
//
// Pure presentational. Returns null when count is 0 so the indicator is only
// visible when there's something to communicate.

type OmittedIndicatorProps = {
  count: number;
};

export function OmittedIndicator({ count }: OmittedIndicatorProps) {
  if (count <= 0) {
    return null;
  }
  // English message; this is the only chat-surface string we render via
  // logic. If the project adds i18n later, replace with a t() call.
  const noun = count === 1 ? 'message' : 'messages';
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="omitted-indicator"
      className="mx-auto my-2 inline-flex items-center gap-2 rounded-md border border-chat-rule bg-chat-panel px-3 py-1 text-xs text-chat-ink-3"
    >
      <span aria-hidden="true">⋯</span>
      <span>
        {count} earlier {noun} omitted from context
      </span>
    </div>
  );
}
