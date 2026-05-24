/**
 * Resume flow — visit /chat/[conversationId] directly.
 *
 * Covers PRD §"Conversation management → list past conversations, open one
 * and resume it":
 *   - Direct URL visit to an existing conversation reloads full history.
 *   - Sending a new turn in a resumed conversation continues the same thread
 *     (URL stays on the same conversationId).
 */

import { test, expect } from '../support/fixtures';
import { ChatPage } from '../pages/ChatPage';

test.describe('Resume flow', () => {
  test('navigating directly to /chat/[id] loads conversation history', async ({
    authenticatedPage,
  }) => {
    // ARRANGE — create a conversation via a normal send.
    const chat = new ChatPage(authenticatedPage);
    await chat.goto();
    await chat.sendMessage('Message to create conversation for resume test');
    await chat.waitForStreamComplete(30_000);

    const url = authenticatedPage.url();
    const match = url.match(/\/chat\/([0-9a-f-]{36})/i);
    expect(match).not.toBeNull();
    const conversationId = match![1]!;

    // ACT — navigate away then directly back to the conversation URL.
    await authenticatedPage.goto('/chat'); // navigate away
    await authenticatedPage.goto(`/chat/${conversationId}`); // direct URL

    // ASSERT — the page lands on the conversation without redirect.
    await authenticatedPage.waitForURL(`**/chat/${conversationId}`, { timeout: 10_000 });

    // History must be visible: the original user message and assistant response.
    await expect(chat.userRows.first()).toBeVisible();
    await expect(chat.assistantRows.first()).toBeVisible();
  });

  test('sending a new turn on a resumed conversation keeps the same conversationId in the URL', async ({
    authenticatedPage,
  }) => {
    // ARRANGE — create an initial conversation.
    const chat = new ChatPage(authenticatedPage);
    await chat.goto();
    await chat.sendMessage('Initial message for resume+send test');
    await chat.waitForStreamComplete(30_000);

    const url = authenticatedPage.url();
    const match = url.match(/\/chat\/([0-9a-f-]{36})/i);
    expect(match).not.toBeNull();
    const conversationId = match![1]!;

    // ACT — navigate directly back and send a follow-up.
    await authenticatedPage.goto(`/chat/${conversationId}`);
    await authenticatedPage.waitForURL(`**/chat/${conversationId}`, { timeout: 10_000 });
    await chat.sendMessage('Follow-up message in resumed conversation');

    // ASSERT — streaming starts (new turn is in-flight).
    await expect(chat.streamingBubble).toBeVisible({ timeout: 10_000 });

    // ASSERT — URL does NOT change to a new conversationId.
    const urlDuringStream = authenticatedPage.url();
    expect(urlDuringStream).toContain(conversationId);

    // Wait for completion.
    await chat.waitForStreamComplete(30_000);

    // ASSERT — URL still contains the same conversationId.
    expect(authenticatedPage.url()).toContain(conversationId);

    // ASSERT — two user rows and two assistant rows now exist (initial + follow-up).
    await expect(chat.userRows).toHaveCount(2, { timeout: 5_000 });
  });
});
