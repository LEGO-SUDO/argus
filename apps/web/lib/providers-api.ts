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
// Wire shapes. The catalog row is the JSON the `GET /api/providers` endpoint
// returns — structurally identical to the SDK's `ConfiguredProviderEntry`
// (apps/api/src/common/sdk-catalog.provider.ts → packages/sdk listConfigured-
// Providers), but declared locally because `apps/web` deliberately does NOT
// depend on `@argus/sdk`: the SDK is server-side (provider adapters, env-key
// reads) and importing it — even type-only — would drag it into the client
// bundle. This type is therefore the web-side REST DTO mirror of that
// contract, kept field-for-field in sync. The PATCH pin body conforms to
// `@argus/contracts` `UpdateConversationRequest` (both fields move together).

'use client';

import type { UpdateConversationRequest } from '@argus/contracts';

import { authFetch } from './auth-fetch';

/**
 * One catalog row per (provider, model) pair. `null` cost / context-window
 * means "unknown" — the ProviderPicker renders an em-dash placeholder.
 *
 * Mirrors `ConfiguredProviderEntry` from `@argus/sdk` (the `/api/providers`
 * response element). See the module docstring for why it is declared locally.
 */
export type ProviderCatalogEntry = {
  provider: string;
  model: string;
  promptPerMillion: number | null;
  completionPerMillion: number | null;
  contextWindow: number | null;
  /**
   * Whether the model is currently usable. The api derives this from the
   * recent inference log (a model failing repeatedly in the last hour reports
   * `false`). Optional on the wire for backward-compat: a missing flag is
   * treated as available, so only an explicit `false` greys the entry out.
   */
  available?: boolean;
};

/** Response body of `GET /api/providers`. */
export type ProviderCatalog = {
  providers: ProviderCatalogEntry[];
};

/**
 * Body of the pin-set PATCH. Both fields are required strings here — the
 * coupling rule in `@argus/contracts` `UpdateConversationRequest` mandates
 * that `pinnedProvider`/`pinnedModel` move together (both strings to set,
 * both null to clear). This helper-level type enforces the "set" half; the
 * clear path sends `{ pinnedProvider: null, pinnedModel: null }` so the two
 * fields never go out asymmetrically (an asymmetric body is a 4xx). The
 * `satisfies` assertions below keep both shapes conformant with the contract.
 */
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
  // `satisfies` pins the body to the contract so a future shape drift fails
  // typecheck here rather than silently 4xx-ing at runtime. Both fields are
  // present-as-strings → the contract's coupling rule is satisfied.
  const payload = {
    pinnedProvider: body.pinnedProvider,
    pinnedModel: body.pinnedModel,
  } satisfies UpdateConversationRequest;
  await authFetch<void>(`/api/conversations/${conversationId}`, {
    method: 'PATCH',
    body: payload,
  });
}

/**
 * Clear a conversation's pin (Auto-switch path). PATCHes
 * `/api/conversations/:id` with BOTH pin fields nulled together — an
 * asymmetric body (one field null, the other omitted) is rejected by the
 * backend coupling rule. ApiError on 4xx propagates unchanged.
 */
export async function clearConversationPin(
  conversationId: string,
): Promise<void> {
  // Both null → the contract's "clear" branch. `satisfies` guards the shape.
  const payload = {
    pinnedProvider: null,
    pinnedModel: null,
  } satisfies UpdateConversationRequest;
  await authFetch<void>(`/api/conversations/${conversationId}`, {
    method: 'PATCH',
    body: payload,
  });
}
