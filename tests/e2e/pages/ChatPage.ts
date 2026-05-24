/**
 * ChatPage POM — wraps /chat and /chat/[conversationId] selectors and actions.
 *
 * Selectors are keyed on data-testid attributes from:
 *   - apps/web/components/chat/MessageStream.tsx
 *   - apps/web/components/chat/MessageComposer.tsx
 *   - apps/web/components/chat/MessageList.tsx
 *   - apps/web/components/chat/ConversationList.tsx
 *   - apps/web/components/chat/LogoutButton.tsx
 *   - apps/web/app/chat/layout.tsx
 */

import { type Page, type Locator, expect } from '@playwright/test';

export class ChatPage {
  readonly page: Page;

  // Layout
  readonly shell: Locator;
  readonly sidebar: Locator;

  // Composer
  readonly composerInput: Locator;
  readonly sendButton: Locator;

  // Stream surface
  readonly messageStream: Locator;
  readonly streamingBubble: Locator;
  readonly cancelButton: Locator;

  // Message list
  readonly messageList: Locator;

  // Sidebar / conversation list
  readonly conversationListEmpty: Locator;
  readonly conversationListEmptyCta: Locator;
  readonly conversationList: Locator;

  // Auth
  readonly logoutButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.shell = page.getByTestId('chat-shell');
    this.sidebar = page.getByTestId('chat-sidebar');

    this.composerInput = page.getByTestId('message-composer-input');
    this.sendButton = page.getByTestId('message-composer-send');

    this.messageStream = page.getByTestId('message-stream');
    this.streamingBubble = page.getByTestId('message-stream-streaming');
    this.cancelButton = page.getByTestId('message-stream-cancel');

    this.messageList = page.getByTestId('message-list');

    this.conversationListEmpty = page.getByTestId('conversation-list-empty');
    this.conversationListEmptyCta = page.getByTestId('conversation-list-empty-cta');
    this.conversationList = page.getByTestId('conversation-list');

    this.logoutButton = page.getByTestId('logout-button');
  }

  async goto(conversationId?: string) {
    await this.page.goto(conversationId ? `/chat/${conversationId}` : '/chat');
  }

  async sendMessage(text: string) {
    await this.composerInput.fill(text);
    await this.sendButton.click();
  }

  /**
   * Wait for the streaming bubble to appear and then disappear (i.e. the
   * assistant response reached a terminal state: complete, canceled, or failed).
   * Playwright's built-in timeout handles the wait automatically.
   */
  async waitForStreamComplete(timeoutMs = 30_000) {
    // streaming bubble must first appear
    await expect(this.streamingBubble).toBeVisible({ timeout: timeoutMs });
    // then disappear once the terminal frame arrives
    await expect(this.streamingBubble).not.toBeVisible({ timeout: timeoutMs });
  }

  /**
   * Returns the Locator for a specific conversation item in the sidebar.
   */
  conversationItem(id: string): Locator {
    return this.page.getByTestId(`conversation-list-item-${id}`);
  }

  /**
   * Returns the Locator for an assistant message's retry button.
   */
  retryButtonFor(messageId: string): Locator {
    return this.page.getByTestId(`message-retry-${messageId}`);
  }

  /**
   * Returns all [data-testid="message-row-assistant"] rows currently in the DOM.
   */
  get assistantRows(): Locator {
    return this.page.getByTestId('message-row-assistant');
  }

  /**
   * Returns all [data-testid="message-row-user"] rows currently in the DOM.
   */
  get userRows(): Locator {
    return this.page.getByTestId('message-row-user');
  }

  /**
   * Returns the Locator for the omitted-indicator when N > 0 messages were
   * dropped from context.
   */
  get omittedIndicator(): Locator {
    return this.page.getByTestId('omitted-indicator');
  }
}
