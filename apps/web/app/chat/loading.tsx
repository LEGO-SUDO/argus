// /chat/loading.tsx — route-segment Suspense fallback for the page slot.
//
// The meaningful chat UI (MessageStream + composer) is hoisted into the chat
// LAYOUT via ChatShell → ChatSurface and stays mounted across the
// `/chat` → `/chat/<id>` URL swap. The page components under this segment
// render `null`; their only async work is a server-side ownership probe.
//
// So this fallback must render NOTHING: when the `[conversationId]` page
// suspends on that probe (which happens on the very first `start` frame of a
// new conversation, when the client calls `router.replace('/chat/<id>')`), a
// visible "Loading…" block here would mount as a sibling of the always-present
// ChatSurface in ChatShell's flex column — stealing height and shoving the
// composer up off the bottom, then snapping it back when the page resolves.
// ChatSurface already owns its own "Loading conversation…" state for genuine
// history hydration, so an empty fallback here is correct, not a regression.
export default function ChatLoading() {
  return null;
}
