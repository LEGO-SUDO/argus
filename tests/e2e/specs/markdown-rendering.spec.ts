/**
 * Markdown rendering — assistant bubble renders Markdown end-to-end (LLD
 * Tasks 86-87).
 *
 * Runs against the live compose stack. The deterministic Markdown payload
 * comes from the mock provider via the `MOCK_RESPONSE` env override: the
 * operator launches the stack with `MOCK_RESPONSE` set to the contents of
 * `apps/web/__tests__/fixtures/markdown-payload.md` so every mock turn
 * returns that exact Markdown. (The scope boundary forbids editing
 * packages/sdk, so we use the adapter's existing MOCK_RESPONSE lever rather
 * than adding a prompt-keyed seed map.)
 *
 *   Launch:
 *     MOCK_PROVIDER=true \
 *     MOCK_RESPONSE="$(cat apps/web/__tests__/fixtures/markdown-payload.md)" \
 *     docker compose -f infra/compose/docker-compose.yml up -d --wait
 *
 * The spec sends a prompt, waits for terminal state, asserts the rendered
 * bubble contains the expected semantic elements, then captures a screenshot
 * matched against a committed Playwright baseline (toHaveScreenshot). The
 * runner picks the snapshot filename + project/platform suffix.
 */

import { test, expect } from '../support/fixtures';
import { ChatPage } from '../pages/ChatPage';

test.describe('Markdown rendering', () => {
  test('renders the deterministic Markdown payload in the assistant bubble', async ({
    authenticatedPage,
  }) => {
    const chat = new ChatPage(authenticatedPage);
    await chat.goto();

    // Send any prompt — with MOCK_RESPONSE set to the fixture, the mock
    // returns the Markdown payload regardless of prompt text.
    await chat.sendMessage('render the demo markdown');
    await chat.waitForTerminalState(30_000);

    const content = chat.latestAssistantContent;
    await expect(content).toBeVisible();

    // Semantic shape assertions — robust regardless of exact whitespace.
    await expect(content.locator('h1, h2')).not.toHaveCount(0);
    await expect(content.locator('strong').first()).toBeVisible();
    await expect(content.locator('em').first()).toBeVisible();
    await expect(content.locator('ul li').first()).toBeVisible();
    await expect(content.locator('pre code').first()).toBeVisible();
    await expect(content.locator('table')).toBeVisible();
    await expect(
      content.locator('input[type="checkbox"]').first(),
    ).toBeVisible();

    // Visual baseline — Playwright manages the snapshot filename + suffix.
    // First run (or `--update-snapshots`) writes the baseline (LLD Task 87).
    await expect(content).toHaveScreenshot();
  });
});
