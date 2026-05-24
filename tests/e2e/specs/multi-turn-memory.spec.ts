/**
 * Multi-turn memory against a REAL provider — env-gated (LLD Task 149).
 *
 * This spec needs a model that genuinely carries conversation context, so it
 * runs ONLY when REAL_PROVIDER is set (with the matching API key configured
 * on the compose stack). When the env is absent — the default for CI and the
 * build worktree — `skipIfRealProviderAbsent()` skips the test cleanly.
 *
 * Flow: sign in → pick the configured real-provider model → "my name is
 * Priya" → wait for terminal → "what is my name?" → the second response
 * contains "Priya".
 *
 * Verify (operator, with a key configured):
 *   REAL_PROVIDER=openai pnpm --filter @argus/e2e test specs/multi-turn-memory.spec.ts
 */

import { test, expect } from '../support/fixtures';
import { ChatPage } from '../pages/ChatPage';
import { skipIfRealProviderAbsent } from '../support/realProviderGate';

test.describe('Multi-turn memory — real provider', () => {
  test('the assistant recalls a name introduced in a prior turn', async ({
    authenticatedPage,
  }) => {
    const provider = skipIfRealProviderAbsent();
    // Past this point `provider` is defined (test.skip short-circuits above).
    const chat = new ChatPage(authenticatedPage);
    await chat.goto();

    // Pick the first available model for the configured provider. We open the
    // picker and click the first option in that provider's group. The model
    // id is operator-dependent, so select by provider-prefixed testid.
    await chat.openProviderPicker();
    const providerOptions = authenticatedPage.locator(
      `[data-testid^="provider-picker-option-${provider}-"]`,
    );
    await expect(providerOptions.first()).toBeVisible({ timeout: 10_000 });
    await providerOptions.first().click();
    await expect(chat.providerPickerListbox).not.toBeVisible();

    // Turn 1 — introduce the name.
    await chat.sendMessage('My name is Priya. Remember it.');
    await chat.waitForStreamComplete(60_000);

    // Turn 2 — ask for the name back.
    await chat.sendMessage('What is my name?');
    await chat.waitForStreamComplete(60_000);

    // The second assistant response must contain "Priya" — proving the prior
    // turn's content was forwarded as conversation history.
    const secondResponse = chat.assistantRows.nth(1);
    await expect(secondResponse).toContainText(/priya/i, { timeout: 10_000 });
  });
});
