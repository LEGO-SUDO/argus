/**
 * Playwright globalSetup — runs once before the test suite.
 *
 * Responsibilities:
 *   1. Verify the web service is reachable (compose stack must be up).
 *   2. Verify the API service is reachable.
 *   3. Idempotently confirm the demo user exists by attempting a login.
 *      The seed is performed by `apps/api` on boot (HLD D5); this step
 *      only validates the credential, it does not create the user.
 *
 * If the stack is not up the setup throws a clear error rather than letting
 * every test fail with an obscure connection-refused message.
 */

import { chromium, FullConfig } from '@playwright/test';

const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:3000';
const API_URL = process.env['PLAYWRIGHT_API_URL'] ?? 'http://localhost:4000';
const DEMO_EMAIL = process.env['DEMO_EMAIL'] ?? 'demo@argus.dev';
const DEMO_PASSWORD = process.env['DEMO_PASSWORD'] ?? 'let-me-in-9';

async function waitForHttp(
  url: string,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (res.ok || res.status < 500) {
        return;
      }
    } catch {
      // not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `[global-setup] ${label} is not reachable at ${url} after ${timeoutMs}ms.\n` +
      `Make sure the compose stack is running:\n` +
      `  docker compose -f infra/compose/docker-compose.yml up -d --wait`,
  );
}

export default async function globalSetup(_config: FullConfig) {
  // 1. Verify web is up.
  await waitForHttp(BASE_URL, 'web (Next.js)');

  // 2. Verify api is up.
  await waitForHttp(`${API_URL}/healthz`, 'api (NestJS)');

  // 3. Confirm demo user is seeded by performing a test login.
  //    We use a fresh browser context rather than raw fetch so the Set-Cookie
  //    flow is exercised and we can verify the redirect happens — a sign that
  //    auth is wired end-to-end, not just that the endpoint returns 200.
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  try {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(DEMO_EMAIL);
    await page.getByTestId('login-password').fill(DEMO_PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL('**/chat', { timeout: 15_000 });
  } catch (err) {
    throw new Error(
      `[global-setup] Demo user login failed.\n` +
        `Credentials: ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n` +
        `Check that the api seeded the demo user on boot (apps/api/src/bootstrap/seed.ts).\n` +
        `Original error: ${(err as Error).message}`,
    );
  } finally {
    await browser.close();
  }
}
