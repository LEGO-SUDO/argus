// Provider adapter contract.
//
// Every concrete provider (mock, openai, anthropic, gemini) implements this
// interface and nothing else; the router selects + invokes adapters through
// this shape so adding a fifth provider is one file + one entry in the router
// priority list.
//
// Design notes:
//   - `isConfigured()` is a synchronous env check. The router calls it BEFORE
//     trying an adapter so a missing key never costs a wasted request. The
//     mock adapter always returns true.
//   - `stream()` returns an AsyncIterable<ChatStreamChunk> — same shape the
//     api gateway already consumes. The adapter MUST throw ProviderError on
//     pre-first-token failure so the router can fail over. Post-first-token
//     errors should propagate naturally (the orchestrator handles).
//   - `listModels()` is a synchronous accessor returning the model ids this
//     adapter advertises. Added in the chat-context-and-ux-polish backbone
//     (LLD Task 20) so the picker REST endpoint can enumerate model choices
//     without knowing which provider implementation backs each one.
//   - `name` is a discriminant the router uses for OTel attributes + log
//     diagnostics. Keep the literal-union tight so a typo at the call site
//     fails to compile.

import type { ChatStreamChunk, ChatStreamRequest } from '../index';

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'mock';

export interface ProviderAdapter {
  readonly name: ProviderName;
  /** True if the adapter's env (API key etc.) is set and it should be tried. */
  isConfigured(): boolean;
  /**
   * Model ids this adapter advertises (matches the pricebook entries for
   * this provider). Synchronous because each adapter knows its own catalog
   * at load time. (LLD Task 20)
   */
  listModels(): string[];
  /** Open a streaming completion. See module docstring for error semantics. */
  stream(req: ChatStreamRequest): AsyncIterable<ChatStreamChunk>;
}
