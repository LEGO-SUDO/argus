// providers-api — typed REST helpers for the provider catalog and the
// per-conversation pin (LLD Block D, Tasks 57-66).
//
// All three helpers delegate serialization + error mapping to `authFetch`:
//   - the body object is passed through `authFetch`'s `body` option (NOT
//     pre-stringified — authFetch owns Content-Type + JSON.stringify);
//   - ApiError (4xx) propagates UNCHANGED so callers can branch on
//     status/code (e.g. surface an inline notice on `invalid_pin`). The
//     helpers deliberately have no try/catch.
//
// Wire shapes mirror the LLD "Locked Contracts" section. The catalog row
// shape (one entry per (provider, model) pair) and the PATCH pin body are
// the source-of-truth promise the backend commits to in the backbone PR.

'use client';

import { authFetch } from './auth-fetch';

/**
 * One catalog row per (provider, model) pair. `null` cost / context-window
 * means "unknown" — the ProviderPicker renders an em-dash placeholder.
 */
export type ProviderCatalogEntry = {
  provider: string;
  model: string;
  promptPerMillion: number | null;
  completionPerMillion: number | null;
  contextWindow: number | null;
};

/** Response body of `GET /api/providers`. */
export type ProviderCatalog = {
  providers: ProviderCatalogEntry[];
};

/** Body of the pin-set PATCH. */
export type ConversationPinBody = {
  pinnedProvider: string;
  pinnedModel: string;
};

/**
 * Fetch the provider catalog. Returns the parsed payload unchanged; the
 * picker groups by provider client-side.
 */
export async function fetchProviderCatalog(): Promise<ProviderCatalog> {
  return authFetch<ProviderCatalog>('/api/providers', { method: 'GET' });
}

/**
 * Pin a conversation to a specific (provider, model). PATCHes
 * `/api/conversations/:id`. ApiError on 4xx propagates unchanged.
 */
export async function patchConversationPin(
  conversationId: string,
  body: ConversationPinBody,
): Promise<void> {
  await authFetch<void>(`/api/conversations/${conversationId}`, {
    method: 'PATCH',
    body,
  });
}

/**
 * Clear a conversation's pin (Auto-switch path). PATCHes
 * `/api/conversations/:id` with both pin fields nulled. ApiError on 4xx
 * propagates unchanged.
 */
export async function clearConversationPin(
  conversationId: string,
): Promise<void> {
  await authFetch<void>(`/api/conversations/${conversationId}`, {
    method: 'PATCH',
    body: { pinnedProvider: null, pinnedModel: null },
  });
}
