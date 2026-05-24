/**
 * LoginPage POM — wraps /login selectors and actions.
 *
 * All selectors are keyed on data-testid attributes shipped by the
 * frontend-web worker (apps/web/app/(auth)/login/page.tsx).
 */

import { type Page, type Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;

  // Selectors
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByTestId('login-email');
    this.passwordInput = page.getByTestId('login-password');
    this.submitButton = page.getByTestId('login-submit');
    this.errorBanner = page.getByTestId('login-error');
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
