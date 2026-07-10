/**
 * e2e/offline-guard.spec.ts — Live offline-guard assertion (P9-2, spec principles-and-invariants X-1).
 *
 * Promotes the static X-1 offline guard (which checks the deck template for
 * external URL strings) to a LIVE check over real browser-loaded pages.
 *
 * For both the editor (/) and the present route (/present/<deck>/) this spec:
 *  - Intercepts every network request made by the page (and iframes within it).
 *  - Fails if any request targets an external http(s):// origin — i.e., any
 *    URL that is NOT localhost / 127.0.0.1.
 *  - Allows: relative URLs, localhost:*, 127.0.0.1:*.
 *
 * Why this matters (spec principles-and-invariants):
 *  "Core editing and presenting work with zero network."
 *  reveal.js, fonts, themes are all vendored offline. If any of them slip a
 *  CDN URL in, this test will catch it immediately in a real browser.
 *
 * Implementation note — page.on('request') vs route interception:
 *  We use page.on('request') (observe-only) rather than page.route() so that
 *  we do NOT block legitimate localhost requests; we just collect violations
 *  and assert at the end. iframes are covered because Playwright's request
 *  listener fires for all frames in the page context.
 *
 * SETUP: this spec scaffolds and owns its own deck (see fixtures.ts — specs
 * never share a deck).
 */

import { test, expect } from '@playwright/test';

import { createDeck } from './fixtures.ts';

/** This spec's private deck. Never share a deck between spec files. */
const DECK = 'e2e-offline-guard';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Returns true if the URL points to an external (non-local) host. */
function isExternal(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return false; // data:, blob:, etc.
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return false; // malformed URL — not our problem
  }
}

// ---------------------------------------------------------------------------
// Shared assertion helper used by both editor and present specs
// ---------------------------------------------------------------------------

/**
 * Navigate to `path`, collect all network requests made while the page loads
 * (including from iframes), and assert none go to an external host.
 */
async function assertNoExternalRequests(
  page: import('@playwright/test').Page,
  path: string,
  waitSelector: string,
): Promise<void> {
  const externalRequests: string[] = [];

  // Listen BEFORE navigating so we don't miss early requests.
  page.on('request', (req) => {
    const url = req.url();
    if (isExternal(url)) {
      externalRequests.push(url);
    }
  });

  await page.goto(path);

  // Wait until the page is meaningfully loaded before checking.
  // This ensures reveal.js (and all its plugins) have had a chance to fire
  // any external requests they might make.
  await page.locator(waitSelector).waitFor({ timeout: 10_000 });

  // Give any lazy/deferred resource loads a moment to settle.
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {
    // networkidle can time out on SSE connections — that's fine.
  });

  // Assert: no external requests.
  expect(
    externalRequests,
    `Page "${path}" made ${externalRequests.length} external request(s):\n` +
      externalRequests.map((u) => `  • ${u}`).join('\n'),
  ).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  await createDeck(DECK);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Offline guard — no external requests (P9-2 / X-1)', () => {
  test('editor (/) makes no external http(s) requests', async ({ page }) => {
    // Wait for the deck button to confirm the SPA has bootstrapped fully
    // (including GET /api/decks, iframe load, etc.).
    await assertNoExternalRequests(
      page,
      '/',
      `ul button:has-text("${DECK}")`,
    );
  });

  test('present route (/present/<deck>/) makes no external http(s) requests', async ({ page }) => {
    // The present route serves the pure deck.html (no editor chrome).
    // Wait for the .reveal root to confirm reveal.js finished bootstrapping.
    await assertNoExternalRequests(
      page,
      `/present/${DECK}/`,
      '.reveal',
    );
  });
});
