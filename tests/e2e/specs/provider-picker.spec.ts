/**
 * ProviderPicker — happy-path selection + pin persistence (LLD Tasks
 * 145-146).
 *
 * Runs against the live compose stack with MOCK_PROVIDER=true so no real API
 * keys are required. The mock adapter exposes `mock` / `mock-1` via
 * listModels(), which the picker surfaces (the stable identifiers the LLD
 * locks for the CI-safe specs).
 *
 * Covers:
 *   - Open the picker, select mock/mock-1, send a turn, assert the assistant
 *     message's provider chip reads `mock` + `mock-1`.
 *   - Pick mock/mock-1, hard-refresh, assert the picker trigger still reads
 *     the pinned label on first paint (pin persisted server-side).
 */

import { test, expect } from '../support/fixtures';
import { ChatPage } from '../pages/ChatPage';

test.describe('ProviderPicker — happy path', () => {
  test('select a model, send a turn, and see the provider chip on the response', async ({
    authenticatedPage,
  }) => {
    const chat = new ChatPage(authenticatedPage);
    await chat.goto();

    // The picker is disabled on a brand-new conversation only if no catalog
    // loaded; with MOCK_PROVIDER=true the catalog has mock/mock-1.
    await chat.pickModel('mock', 'mock-1');

    // The trigger reflects the selection.
    await expect(chat.providerPickerTrigger).toHaveText(/mock.*mock-1/);

    // Send a turn; the pinned model serves it.
    await chat.sendMessage('Hello with a pinned model');
    await chat.waitForStreamComplete(30_000);

    // The committed assistant message's provider chip reads mock / mock-1.
    const provider = chat.latestAssistantBubble.getByTestId(
      'message-stream-provider',
    );
    const model = chat.latestAssistantBubble.getByTestId('message-stream-model');
    await expect(provider).toHaveText(/mock/i);
    await expect(model).toHaveText(/mock-1/i);
  });
});

test.describe('ProviderPicker — pin persistence', () => {
  test('the pin survives a hard page refresh', async ({ authenticatedPage }) => {
    const chat = new ChatPage(authenticatedPage);
    await chat.goto();

    // Send a turn first so a conversation row exists to pin against, then
    // pin the model.
    await chat.sendMessage('Create a conversation to pin against');
    await chat.waitForStreamComplete(30_000);

    const url = authenticatedPage.url();
    const match = url.match(/\/chat\/([0-9a-f-]{36})/i);
    expect(match).not.toBeNull();
    const conversationId = match![1]!;

    await chat.pickModel('mock', 'mock-1');
    await expect(chat.providerPickerTrigger).toHaveText(/mock.*mock-1/);

    // Hard refresh the conversation URL.
    await authenticatedPage.goto(`/chat/${conversationId}`);
    await authenticatedPage.waitForURL(`**/chat/${conversationId}`, {
      timeout: 10_000,
    });

    // On first paint after refresh the trigger reflects the persisted pin.
    await expect(chat.providerPickerTrigger).toHaveText(/mock.*mock-1/, {
      timeout: 10_000,
    });
  });
});
