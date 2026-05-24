/**
 * Composer focus persistence — keyboard-only flow (LLD Task 147).
 *
 * Runs against the live compose stack with MOCK_PROVIDER=true. Sends five
 * consecutive prompts using ONLY the keyboard — no mouse clicks on the
 * composer textarea between turns — and asserts the textarea is focused
 * before each send and immediately after each turn completes. Covers the
 * URL transition from /chat to /chat/<id> on the first send (the composer
 * must regain focus across that navigation since MessageStream is hosted in
 * the stable layout).
 *
 * The useFocusComposer hook drives this: focus on mount, focus on the
 * streaming-lock falling edge (turn complete), focus on conversationId change.
 */

import { test, expect } from '../support/fixtures';
import { ChatPage } from '../pages/ChatPage';

test.describe('Composer focus persistence', () => {
  test('keeps the composer focused across five keyboard-only turns', async ({
    authenticatedPage,
  }) => {
    const chat = new ChatPage(authenticatedPage);
    await chat.goto();

    // On initial load the composer should hold focus (useFocusComposer mount
    // effect). Give the layout a beat to settle.
    await expect(chat.composerInput).toBeFocused({ timeout: 10_000 });

    for (let i = 1; i <= 5; i++) {
      // Type without clicking — focus must already be on the textarea.
      await expect(chat.composerInput).toBeFocused();
      await chat.composerInput.type(`Keyboard-only turn ${i}`);
      // Submit via Enter (no mouse).
      await chat.composerInput.press('Enter');

      // The turn streams then completes.
      await chat.waitForStreamComplete(30_000);

      // After the streaming lock releases, focus returns to the composer
      // automatically (falling-edge effect). On the FIRST turn this also
      // spans the /chat → /chat/<id> URL swap.
      await expect(chat.composerInput).toBeFocused({ timeout: 10_000 });
    }

    // Sanity: five user rows and five assistant rows landed.
    await expect(chat.userRows).toHaveCount(5, { timeout: 10_000 });
    await expect(chat.assistantRows).toHaveCount(5, { timeout: 10_000 });
  });
});
