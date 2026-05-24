/**
 * SignupPage POM — wraps /signup selectors and actions.
 *
 * All selectors are keyed on data-testid attributes shipped by the
 * frontend-web worker (apps/web/app/(auth)/signup/page.tsx).
 */

import { type Page, type Locator } from '@playwright/test';

export class SignupPage {
  readonly page: Page;

  // Selectors
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmInput: Locator;
  readonly submitButton: Locator;
  readonly errorBanner: Locator;
  readonly confirmMismatch: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByTestId('signup-email');
    this.passwordInput = page.getByTestId('signup-password');
    this.confirmInput = page.getByTestId('signup-confirm');
    this.submitButton = page.getByTestId('signup-submit');
    this.errorBanner = page.getByTestId('signup-error');
    this.confirmMismatch = page.getByTestId('signup-confirm-mismatch');
  }

  async goto() {
    await this.page.goto('/signup');
  }

  async signup(email: string, password: string, confirm?: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.confirmInput.fill(confirm ?? password);
    await this.submitButton.click();
  }
}
