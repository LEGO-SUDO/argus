# Argus Chatbot — E2E Tests

Playwright end-to-end tests for the Argus chatbot web surface.

## Prerequisites

- Docker + Docker Compose V2
- Node.js ≥ 20, pnpm ≥ 10
- No API keys required — the suite runs against the mock provider

## Running e2e tests

### 1. Boot the compose stack

```bash
# From the repository root
cp .env.example .env          # only needed once
docker compose -f infra/compose/docker-compose.yml up -d --wait
```

The `--wait` flag blocks until all healthchecks pass (api, workers, web). This typically takes 30–60 seconds on first boot (image pulls). Subsequent boots are much faster.

Confirm everything is healthy:

```bash
docker compose -f infra/compose/docker-compose.yml ps
curl -fsS http://localhost:4000/healthz | jq   # api
curl -fsS http://localhost:3002/healthz | jq   # workers
```

### 2. Install dependencies

```bash
pnpm install
pnpm --filter @argus/e2e exec playwright install chromium
```

### 3. Run the suite

```bash
# From the repository root
pnpm e2e

# Or directly from this directory
pnpm test
```

### 4. View the HTML report

```bash
pnpm --filter @argus/e2e report
# Opens playwright-report/index.html in the default browser
```

### Environment variables

All variables have defaults that match the compose stack. Override only when needed:

| Variable | Default | Description |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:3000` | URL of the Next.js web service |
| `PLAYWRIGHT_API_URL` | `http://localhost:4000` | URL of the NestJS api service |
| `DEMO_EMAIL` | `demo@argus.dev` | Demo user email (seeded on boot) |
| `DEMO_PASSWORD` | `let-me-in-9` | Demo user password |

### Headed / debug mode

```bash
pnpm --filter @argus/e2e test:headed   # open a real browser
pnpm --filter @argus/e2e test:ui       # Playwright Test UI
```

## Suite structure

```
tests/e2e/
  playwright.config.ts      # config: baseURL, reporter, trace, screenshot
  support/
    global-setup.ts         # health-check + demo-user seed verification
    fixtures.ts             # extended test() with POMs and authenticatedPage
  pages/
    LoginPage.ts            # POM for /login
    SignupPage.ts           # POM for /signup
    ChatPage.ts             # POM for /chat and /chat/[id]
  specs/
    auth.spec.ts            # login, signup, logout, auth redirect (11 tests)
    chat.spec.ts            # send/stream, cancel, retry, sidebar, empty state (10 tests)
    resume.spec.ts          # direct URL visit, continue thread (2 tests)
```

## Tear down

```bash
docker compose -f infra/compose/docker-compose.yml down -v   # also removes volumes
```
