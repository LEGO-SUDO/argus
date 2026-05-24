// /chat/loading.tsx — streaming-friendly loading state for the route segment.
export default function ChatLoading() {
  return (
    <div
      data-testid="chat-route-loading"
      role="status"
      aria-live="polite"
      className="flex h-full items-center justify-center text-sm text-chat-ink-2"
    >
      Loading…
    </div>
  );
}
