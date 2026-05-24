/**
 * Shared Playwright fixtures — extend the base `test` with POMs and
 * a pre-authenticated context so individual tests don't have to repeat
 * the login ceremony.
 *
 * Usage:
 *   import { test, expect } from '../support/fixtures';
 *
 * `authenticatedPage` gives you a Page that already holds a valid session
 * cookie for the demo user. Tests that need an unauthenticated state should
 * use the plain `page` fixture instead (available from Playwright's base).
 */

import { test as base, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { ChatPage } from '../pages/ChatPage';
import { SignupPage } from '../pages/SignupPage';

export const DEMO_EMAIL = process.env['DEMO_EMAIL'] ?? 'demo@argus.dev';
export const DEMO_PASSWORD = process.env['DEMO_PASSWORD'] ?? 'let-me-in-9';

type Fixtures = {
  /** A page that is already logged in as the demo user. */
  authenticatedPage: Page;
  loginPage: LoginPage;
  signupPage: SignupPage;
  chatPage: ChatPage;
};

export const test = base.extend<Fixtures>({
  /**
   * Performs the demo-user login once per test and returns the page positioned
   * on /chat. Tests that require a fresh authenticated page should use this.
   */
  authenticatedPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(DEMO_EMAIL, DEMO_PASSWORD);
    await page.waitForURL('**/chat');
    await use(page);
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  signupPage: async ({ page }, use) => {
    await use(new SignupPage(page));
  },

  chatPage: async ({ page }, use) => {
    await use(new ChatPage(page));
  },
});

export { expect } from '@playwright/test';

/**
 * Generate a unique email for signup tests so reruns don't hit the
 * duplicate-email branch unintentionally.
 */
export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
}
