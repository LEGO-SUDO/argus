/**
 * realProviderGate — conditional-skip primitive for env-gated specs (LLD
 * Task 148).
 *
 * The multi-turn "memory" spec exercises a REAL LLM provider (it needs a
 * model that actually carries conversation context), which requires an API
 * key the CI worktree does not have. Specs that need a real provider call
 * `skipIfRealProviderAbsent()` as their first line so they skip cleanly with
 * a descriptive message when `REAL_PROVIDER` is unset (the default).
 */

import { test } from '@playwright/test';

/**
 * Skip the current test when the `REAL_PROVIDER` env var is unset/empty.
 *
 * `REAL_PROVIDER` names the provider the operator configured (e.g. `openai`,
 * `anthropic`, `google`). When set, the spec runs against that provider's
 * configured model; when absent, the test is skipped with a clear message.
 *
 * @returns the configured provider name when present (so the caller can pick
 *          the matching model), or `undefined` when skipped.
 */
export function skipIfRealProviderAbsent(): string | undefined {
  const provider = process.env['REAL_PROVIDER'];
  test.skip(
    !provider,
    'REAL_PROVIDER is not set — skipping the real-provider multi-turn memory spec. ' +
      'Set REAL_PROVIDER=<openai|anthropic|google> (with the matching API key configured) to run it.',
  );
  return provider;
}
