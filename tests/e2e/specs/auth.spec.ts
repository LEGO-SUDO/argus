/**
 * Auth golden path + error states.
 *
 * Covers PRD §"Authenticated identity" requirements:
 *   - Successful login → /chat
 *   - Wrong password → inline error, stay on /login
 *   - Successful signup with new email → /chat
 *   - Signup with existing (demo) email → duplicate-email error
 *   - Logout → /login
 *   - Unauthenticated visit to /chat → redirected to /login
 *   - Unauthenticated visit to /chat/<id> → redirected to /login
 */

import { test, expect, uniqueEmail, DEMO_EMAIL, DEMO_PASSWORD } from '../support/fixtures';

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

test.describe('Login', () => {
  test('demo user logs in successfully and lands on /chat', async ({ loginPage, page }) => {
    // ARRANGE
    await loginPage.goto();

    // ACT
    await loginPage.login(DEMO_EMAIL, DEMO_PASSWORD);

    // ASSERT — URL must settle on /chat and the chat shell must be visible.
    await page.waitForURL('**/chat', { timeout: 10_000 });
    await expect(page.getByTestId('chat-shell')).toBeVisible();
  });

  test('wrong password shows inline error and stays on /login', async ({ loginPage, page }) => {
    // ARRANGE
    await loginPage.goto();

    // ACT
    await loginPage.login(DEMO_EMAIL, 'definitely-wrong-password');

    // ASSERT — inline error appears, URL does NOT change to /chat.
    await expect(loginPage.errorBanner).toBeVisible();
    await expect(loginPage.errorBanner).toContainText('Invalid email or password');
    expect(page.url()).toContain('/login');
  });

  test('login form submit button is disabled when fields are empty', async ({ loginPage }) => {
    // ARRANGE
    await loginPage.goto();

    // ASSERT — button disabled before any input.
    await expect(loginPage.submitButton).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

test.describe('Signup', () => {
  test('new user signs up and lands on /chat', async ({ signupPage, page }) => {
    // ARRANGE
    const email = uniqueEmail();
    await signupPage.goto();

    // ACT
    await signupPage.signup(email, 'ValidPass99!');

    // ASSERT — redirected to /chat, chat shell renders.
    await page.waitForURL('**/chat', { timeout: 10_000 });
    await expect(page.getByTestId('chat-shell')).toBeVisible();
  });

  test('signup with the existing demo email shows duplicate-email error', async ({
    signupPage,
  }) => {
    // ARRANGE
    await signupPage.goto();

    // ACT — attempt to register with the already-seeded demo email.
    await signupPage.signup(DEMO_EMAIL, 'ValidPass99!');

    // ASSERT — inline error, form stays visible.
    await expect(signupPage.errorBanner).toBeVisible();
    await expect(signupPage.errorBanner).toContainText(
      'An account with that email already exists',
    );
  });

  test('signup with mismatched confirm-password shows mismatch error before submit', async ({
    signupPage,
  }) => {
    // ARRANGE
    await signupPage.goto();

    // ACT — type non-matching confirm value.
    await signupPage.emailInput.fill(uniqueEmail());
    await signupPage.passwordInput.fill('ValidPass99!');
    await signupPage.confirmInput.fill('DifferentPass!');

    // ASSERT — mismatch hint is visible and the submit button is disabled.
    await expect(signupPage.confirmMismatch).toBeVisible();
    await expect(signupPage.submitButton).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test.describe('Logout', () => {
  test('logout button click redirects to /login', async ({ authenticatedPage }) => {
    // ARRANGE — authenticatedPage is on /chat already.
    const logoutButton = authenticatedPage.getByTestId('logout-button');
    await expect(logoutButton).toBeVisible();

    // ACT
    await logoutButton.click();

    // ASSERT
    await authenticatedPage.waitForURL('**/login', { timeout: 10_000 });
    expect(authenticatedPage.url()).toContain('/login');
  });
});

// ---------------------------------------------------------------------------
// Authorization — unauthenticated redirect
// ---------------------------------------------------------------------------

test.describe('Authorization redirect', () => {
  test('unauthenticated visit to /chat redirects to /login', async ({ page }) => {
    // ARRANGE — plain `page` has no session cookie.
    // ACT
    await page.goto('/chat');

    // ASSERT — Next.js server-side redirect fires immediately.
    await page.waitForURL('**/login', { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  });

  test('unauthenticated visit to /chat/<id> redirects to /login', async ({ page }) => {
    // ARRANGE — use a plausible UUID that doesn't need to exist.
    const fakeId = '00000000-0000-4000-8000-000000000001';

    // ACT
    await page.goto(`/chat/${fakeId}`);

    // ASSERT
    await page.waitForURL('**/login', { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  });
});
