// /chat/not-found.tsx — rendered when a conversation id is unknown to the
// current user (the api returns 404 on cross-user access; the resume page
// turns that into notFound()).
import Link from 'next/link';

export default function ConversationNotFound() {
  return (
    <div
      data-testid="conversation-not-found"
      className="m-6 max-w-md rounded-md border border-chat-rule bg-chat-panel p-4 text-sm text-chat-ink-2"
    >
      <p className="font-medium text-chat-ink">Conversation not found</p>
      <p className="mt-1">
        This conversation doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link
        href="/chat"
        data-testid="conversation-not-found-home"
        className="mt-3 inline-flex items-center rounded-md bg-acc px-3 py-1.5 text-sm font-medium text-white hover:bg-acc-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
      >
        Start a new chat
      </Link>
    </div>
  );
}
