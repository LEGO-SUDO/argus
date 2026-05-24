/**
 * Playwright configuration for the Argus chatbot e2e suite.
 *
 * Runs against the local docker-compose stack:
 *   docker compose -f infra/compose/docker-compose.yml up -d --wait
 *
 * Environment variables (all optional — defaults match the compose stack):
 *   PLAYWRIGHT_BASE_URL  — default: http://localhost:3000
 *   PLAYWRIGHT_API_URL   — default: http://localhost:4000
 *   DEMO_EMAIL           — default: demo@argus.dev
 *   DEMO_PASSWORD        — default: let-me-in-9
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  // Test directory — all *.spec.ts files under specs/.
  testDir: path.join(__dirname, 'specs'),

  // Glob — pick up every spec file.
  testMatch: '**/*.spec.ts',

  // Run each test file in parallel; individual tests within a file run serially
  // by default. Keeps flakiness low for stateful chat tests.
  fullyParallel: false,

  // Fail the build if any test.only() is accidentally committed.
  forbidOnly: Boolean(process.env['CI']),

  // Retry once on CI to absorb transient compose-stack hiccups.
  retries: process.env['CI'] ? 1 : 0,

  // One worker: chat state tests write and then read from the same user
  // account. Running them concurrently would interleave conversation lists
  // and make ordering assertions unreliable.
  workers: 1,

  // Run globalSetup before any test to verify the stack is healthy and the
  // demo user is seeded.
  globalSetup: path.join(__dirname, 'support/global-setup.ts'),

  // Reporters: line for terminal, HTML for post-run inspection.
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: BASE_URL,

    // Capture a screenshot on every test failure for debugging.
    screenshot: 'only-on-failure',

    // Record a trace on the first retry so failures are fully inspectable
    // without needing to rerun with --trace on.
    trace: 'on-first-retry',

    // Videos off by default — they add significant disk usage and slow CI.
    // Enable with: PWVIDEO=1 pnpm e2e
    video: process.env['PWVIDEO'] === '1' ? 'on' : 'off',

    // Forward the session cookie automatically via the browser's same-origin
    // rules — no explicit header wiring needed for httpOnly cookies.
    // The WS handshake uses the same cookie.
    ignoreHTTPSErrors: false,

    // Give Next.js + NestJS enough time to respond, especially on first hit
    // after compose boot.
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },

  projects: [
    {
      // Chromium only per scope — Firefox/WebKit are Phase B.
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  // Output directory for test artefacts (screenshots, traces, videos).
  outputDir: 'test-results',
});
