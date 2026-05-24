// conversations-api — typed REST helpers for the conversations + messages
// endpoints.
//
// LLD Task 51. Each function returns a contracts-typed DTO so callers never
// see raw fetch responses.
//
// Routing split (see lib/server-api-fetch.ts for the long form):
//   - When `cookieHeader` is provided → caller is server-side. We use
//     `serverApiFetch` with the BARE api path (`/conversations`, etc.)
//     because the Next.js rewrite `/api/:path*` → `${apiOrigin}/:path*`
//     does NOT run for server-side requests.
//   - When `cookieHeader` is omitted → caller is in the browser. We use
//     `authFetch` with the `/api/...` prefix so the dev rewrite proxies
//     through to the api service.

import type {
  ConversationDto,
  ConversationListResponse,
  MessageDto,
  MessageListResponse,
} from '@argus/contracts';

import { authFetch } from './auth-fetch';
import { serverApiFetch } from './server-api-fetch';

export async function listConversations(
  cookieHeader?: string,
): Promise<ConversationDto[]> {
  if (cookieHeader !== undefined) {
    const res = await serverApiFetch<ConversationListResponse>('/conversations', {
      method: 'GET',
      cookieHeader,
    });
    return res.conversations;
  }
  const res = await authFetch<ConversationListResponse>('/api/conversations', {
    method: 'GET',
  });
  return res.conversations;
}

export async function getMessages(
  conversationId: string,
  cookieHeader?: string,
): Promise<{ messages: MessageDto[]; omittedCount: number }> {
  if (cookieHeader !== undefined) {
    const res = await serverApiFetch<MessageListResponse>(
      `/conversations/${conversationId}/messages`,
      { method: 'GET', cookieHeader },
    );
    return {
      messages: res.messages,
      omittedCount: res.omittedCount ?? 0,
    };
  }
  const res = await authFetch<MessageListResponse>(
    `/api/conversations/${conversationId}/messages`,
    { method: 'GET' },
  );
  return {
    messages: res.messages,
    omittedCount: res.omittedCount ?? 0,
  };
}
