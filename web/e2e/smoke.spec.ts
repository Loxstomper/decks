/**
 * e2e/smoke.spec.ts — Smoke test for the slides-builder editor.
 *
 * Opens the editor in a real browser and asserts:
 *  1. The deck name appears in the navigator (deck-list sidebar).
 *  2. The canvas iframe is visible on the page.
 *  3. The iframe has loaded reveal.js (the .reveal root element is present
 *     inside the iframe's document).
 *
 * This is the minimal browser-side "is the app alive?" check.
 * Feature-specific e2e specs (delete, panes, create-deck, themes, etc.) should
 * be added in separate files in this directory (web/e2e/) following the same
 * pattern:
 *
 *   web/e2e/
 *     smoke.spec.ts          ← this file: basic app load
 *     offline-guard.spec.ts  ← no external URLs (P9-2)
 *     <feature>.spec.ts      ← future: delete, panes, themes, create-deck…
 *
 * All spec files are automatically picked up by playwright.config.ts via
 * `testMatch: '**\/*.spec.ts'` and excluded from vitest via vitest's
 * `include: ['src/**\/*.test.ts']`.
 */

import { test, expect } from '@playwright/test';

// Keep in sync with global-setup.ts SMOKE_DECK constant.
const SMOKE_DECK = 'smoke-deck';

test.describe('Editor smoke test', () => {
  test('loads the editor and renders the canvas iframe', async ({ page }) => {
    // Navigate to the root (the Svelte SPA).
    await page.goto('/');

    // ── 1. Deck appears in the navigator sidebar ─────────────────────────────
    // App.svelte renders a <ul> with one <button> per deck whose text content
    // is the deck name. Wait for it to appear (the fetch to /api/decks is async).
    const deckButton = page.locator('ul button', { hasText: SMOKE_DECK });
    await expect(deckButton).toBeVisible({ timeout: 8_000 });

    // ── 2. Canvas iframe is visible ──────────────────────────────────────────
    // RevealFrame.svelte renders <iframe class="reveal-frame-iframe">.
    // It starts invisible (visibility:hidden while loading), becomes visible
    // after the onload event fires.
    const iframe = page.locator('iframe.reveal-frame-iframe');
    await expect(iframe).toBeVisible({ timeout: 8_000 });

    // ── 3. Reveal.js root element exists inside the iframe ───────────────────
    // The scaffolded deck.html includes <div class="reveal"> as the reveal root.
    // This confirms the iframe actually loaded the deck (not an error page).
    const revealRoot = page
      .frameLocator('iframe.reveal-frame-iframe')
      .locator('.reveal');
    await expect(revealRoot).toBeAttached({ timeout: 8_000 });

    // ── 4. At least one slide section exists ────────────────────────────────
    const firstSlide = page
      .frameLocator('iframe.reveal-frame-iframe')
      .locator('.reveal .slides section')
      .first();
    await expect(firstSlide).toBeAttached({ timeout: 8_000 });
  });
});
