/**
 * playwright.config.ts — Playwright E2E configuration for slides-builder.
 *
 * Tests live in web/e2e/*.spec.ts and run against the BUILT binary
 * (embedded frontend + Go API + a temp workspace). They are intentionally
 * kept out of vitest's include glob (`src/**\/test.ts`) so `npm test`
 * (vitest) never picks them up.
 *
 * Global setup (e2e/global-setup.ts) starts the binary on TEST_PORT
 * (default 19999) against a temp workspace with one scaffolded deck.
 * Global teardown kills the process and removes the temp dir.
 *
 * Run locally (browser must be installed):
 *   npm run test:e2e           # builds binary then runs Playwright
 *
 * Run in Docker (no local browser needed):
 *   docker run --rm -it \
 *     -v "$(pwd)/..":/workspace \
 *     -w /workspace/web \
 *     mcr.microsoft.com/playwright:v1.49.1-jammy \
 *     bash -c "npm ci && cd .. && go build -o slides ./cmd/slides && cd web && npm run test:e2e:docker"
 *
 * (The :docker script skips the Go build step — the binary is already built
 * by the docker command above. See test:e2e:docker in package.json.)
 */

import { defineConfig, devices } from '@playwright/test';

const TEST_PORT = parseInt(process.env.TEST_PORT ?? '19999', 10);
const BASE_URL = `http://localhost:${TEST_PORT}`;

export default defineConfig({
  // e2e/ is separate from src/ so vitest never touches these files
  testDir: './e2e',
  testMatch: '**/*.spec.ts',

  // Fail fast on CI; keep going locally for richer feedback
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // serial: we share one binary process

  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: BASE_URL,
    // Capture trace on failure for debugging
    trace: 'on-first-retry',
    // Short timeout: the server starts in global setup, should be fast
    actionTimeout: 10_000,
  },

  // Global setup/teardown: start and stop the slides binary
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Don't launch the dev server — we manage the binary ourselves
  // webServer is intentionally absent
});
