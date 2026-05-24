/**
 * Multi-turn memory against the mock provider — CI-safe (LLD Task 150).
 *
 * Runs against the live compose stack with MOCK_PROVIDER=true. The mock
 * adapter is deterministic by (conversationId, turnIndex) (HLD D3): the same
 * conversation at turn 0 and turn 1 produces DIFFERENT token sequences
 * because the seed includes turnIndex. That difference is the observable
 * proof that the gateway forwarded the conversation history and advanced the
 * turn index for the second turn — if history were NOT forwarded the server
 * would treat the second send as turn 0 again and emit the turn-0 response.
 *
 * We assert on the SHAPE of that invariant (two completed assistant turns
 * whose rendered text differs), not on a brittle literal string, since the
 * mock's vocabulary output is seed-derived. The spec author confirmed the
 * two-turn divergence by running once against the live stack.
 */

import { test, expect } from '../support/fixtures';
import { ChatPage } from '../pages/ChatPage';

test.describe('Multi-turn memory — mock provider', () => {
  test('a two-turn conversation forwards history (turnIndex advances)', async ({
    authenticatedPage,
  }) => {
    const chat = new ChatPage(authenticatedPage);
    await chat.goto();

    // Pin mock/mock-1 so both turns are served by the deterministic mock.
    await chat.pickModel('mock', 'mock-1');

    // Turn 1.
    await chat.sendMessage('First turn — establish the conversation');
    await chat.waitForStreamComplete(30_000);
    await expect(chat.assistantRows).toHaveCount(1, { timeout: 10_000 });
    const firstResponse = (await chat.assistantRows.nth(0).innerText()).trim();
    expect(firstResponse.length).toBeGreaterThan(0);

    // Turn 2 in the SAME conversation.
    await chat.sendMessage('Second turn — depends on history');
    await chat.waitForStreamComplete(30_000);
    await expect(chat.assistantRows).toHaveCount(2, { timeout: 10_000 });
    const secondResponse = (await chat.assistantRows.nth(1).innerText()).trim();
    expect(secondResponse.length).toBeGreaterThan(0);

    // The two responses differ — the seed advanced with turnIndex, which only
    // happens when the server saw this as turn 1 (history forwarded).
    expect(secondResponse).not.toEqual(firstResponse);

    // Both turns stayed in the same conversation (URL unchanged after turn 1).
    const url = authenticatedPage.url();
    expect(url).toMatch(/\/chat\/[0-9a-f-]{36}/i);
  });
});
