/**
 * e2e/reveal-frame-reload.spec.ts — Playwright spec for P11 (canvas reload
 * preserves view state).
 *
 * WHAT IS TESTED:
 * ===============
 *  1. Same-deck reload (SSE → reload()) — after navigating to slide 2 and
 *     triggering an autosave via the PUT API, the canvas stays on slide 2,
 *     not on slide 1 (the default reveal.js landing position after a reload).
 *     This is the core P11-1 behaviour: pendingRestore captured before reload,
 *     then navigateToSlide(h, v, onArrive) restores it after handleLoad fires.
 *
 *  2. Deck switch resets to slide 1 — opening a DIFFERENT deck (via the
 *     navigator deck-list) always starts at slide 0 (slide 1 in UI terms)
 *     because deckUrl changes drive the {#key} block without setting
 *     pendingRestore; slide position is reset deliberately.
 *
 * PREREQUISITES:
 * ==============
 *  • The default smoke-deck scaffold has two top-level slides (section 0 =
 *    "Your first slide", section 1 = "Slide 2").  No modifications needed.
 *  • A second deck ("p11-reload-deck-b") is created via the "New deck" UI
 *    during the deck-switch test so the navigator renders a second button.
 *
 * CANNOT RUN WITHOUT THE BUILT BINARY:
 * =====================================
 * This is an e2e Playwright spec; it requires the `decks` binary + server.
 * Run with:
 *   npm run test:e2e
 * or in Docker:
 *   npm run test:e2e:docker
 * It CANNOT be run with `npx vitest run`.
 */

import { test, expect, type Page } from '@playwright/test';

const SMOKE_DECK = 'smoke-deck';
const SECOND_DECK = 'p11-reload-deck-b';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The locator for reveal's IFRAME inside the editor. */
const iframeLocator = (page: Page) => page.locator('iframe.reveal-frame-iframe');

/** The frameLocator for querying elements inside the reveal iframe. */
const slidesFrame = (page: Page) => page.frameLocator('iframe.reveal-frame-iframe');

/**
 * Wait for the canvas iframe to be visible (not hidden during loading).
 * RevealFrame keeps visibility:hidden while isLoading is true; it becomes
 * visible once handleLoad (→ isLoading=false) fires — or after navigateToSlide's
 * onArrive callback fires in the P11-2 path.
 */
async function waitForCanvasReady(page: Page): Promise<void> {
  await expect(iframeLocator(page)).toBeVisible({ timeout: 12_000 });
  await expect(
    slidesFrame(page).locator('.reveal .slides section').first(),
  ).toBeAttached({ timeout: 10_000 });
}

/**
 * Navigate to the editor and wait for the smoke deck to be loaded and rendered.
 */
async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  // Wait for the deck button to confirm the SPA has bootstrapped (GET /api/decks done).
  await expect(page.locator('ul button', { hasText: SMOKE_DECK })).toBeVisible({
    timeout: 10_000,
  });
  await waitForCanvasReady(page);
}

/**
 * Click slide N (0-indexed) in the navigator filmstrip and wait for the canvas
 * to show that slide.  The filmstrip renders one `[role="option"]` per top-level
 * slide; clicking it calls navigateToSlide(iframe, h, 0) in the Navigator.
 */
async function navigateToSlideN(page: Page, h: number): Promise<void> {
  const slideRow = page.locator('[role="option"]').nth(h);
  await expect(slideRow).toBeVisible({ timeout: 5_000 });
  await slideRow.click();
  // Wait for reveal to update: the clicked row should get aria-selected="true".
  await expect(slideRow).toHaveAttribute('aria-selected', 'true', { timeout: 8_000 });
  // Also wait for the section.present in the iframe to match the expected slide index.
  // reveal.js sets the .present class on the current <section>.
  await expect(
    slidesFrame(page).locator('.reveal .slides > section').nth(h),
  ).toHaveClass(/present/, { timeout: 8_000 });
}

/**
 * Trigger a server-side SSE "deck changed" event by PUTting the current deck
 * HTML back (unchanged bytes, round-trip).  The backend notifies the app via
 * SSE, the app calls deckStore.onExternalChange(), which eventually calls
 * frame.reload() — and P11 kicks in.
 *
 * Returns a Promise that resolves when the PUT response arrives.
 */
async function triggerReloadViaPut(page: Page, deckName: string): Promise<void> {
  const currentHtml: string = await page.evaluate(async (name: string) => {
    const res = await fetch(`/api/decks/${encodeURIComponent(name)}`);
    return res.text();
  }, deckName);

  // Intercept the PUT so we can await it before asserting.
  const putDone = page.waitForResponse(
    (resp) =>
      resp.url().includes(`/api/decks/${encodeURIComponent(deckName)}`) &&
      resp.request().method() === 'PUT',
    { timeout: 10_000 },
  );

  await page.evaluate(
    async ({ name, html }: { name: string; html: string }) => {
      await fetch(`/api/decks/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: html,
      });
    },
    { name: deckName, html: currentHtml },
  );

  await putDone;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Canvas reload view-state preservation (P11)', () => {
  test(
    'same-deck reload preserves the current slide index (P11-1)',
    async ({ page }) => {
      await openEditor(page);

      // ── 1. Verify we start on slide 1 (section index 0) ───────────────────
      await expect(
        slidesFrame(page).locator('.reveal .slides > section').nth(0),
      ).toHaveClass(/present/, { timeout: 6_000 });

      // ── 2. Navigate to slide 2 (section index 1) via the filmstrip ─────────
      await navigateToSlideN(page, 1);

      // Confirm slide 2 is the present slide before triggering the reload.
      await expect(
        slidesFrame(page).locator('.reveal .slides > section').nth(1),
      ).toHaveClass(/present/, { timeout: 6_000 });

      // ── 3. Trigger a reload via a PUT (simulates an autosave / external edit)
      // The app subscribes to the SSE stream; a PUT causes the server to emit
      // a "deck changed" event for smoke-deck, which the app translates into
      // frame.reload().  The reload() call in RevealFrame captures pendingRestore
      // = { h: 1, v: 0 } BEFORE bumping reloadKey (P11-1).
      await triggerReloadViaPut(page, SMOKE_DECK);

      // ── 4. Wait for the iframe to reload and become visible again ──────────
      // After reload(), the iframe is visibility:hidden (isLoading=true).
      // It becomes visible once the P11-2 onArrive callback fires (after
      // navigateToSlide restores the slide).
      await waitForCanvasReady(page);

      // ── 5. Assert the canvas is still on slide 2, NOT on slide 1 ──────────
      // If P11 is NOT implemented reveal would land back on slide 0 after reload.
      await expect(
        slidesFrame(page).locator('.reveal .slides > section').nth(1),
      ).toHaveClass(/present/, { timeout: 8_000 });

      // Extra guard: slide 1 must NOT be .present.
      await expect(
        slidesFrame(page).locator('.reveal .slides > section').nth(0),
      ).not.toHaveClass(/present/);
    },
  );

  test(
    'switching to a different deck resets the canvas to slide 1 (P11-1 guard)',
    async ({ page }) => {
      await openEditor(page);

      // ── 1. Navigate to slide 2 of the smoke deck ───────────────────────────
      await navigateToSlideN(page, 1);
      await expect(
        slidesFrame(page).locator('.reveal .slides > section').nth(1),
      ).toHaveClass(/present/, { timeout: 6_000 });

      // ── 2. Create a second deck via the "+ Deck" UI ────────────────────────
      // Using the UI ensures the navigator deck-list refreshes reactively, so
      // clicking the new deck button is reliable without extra polling.
      const newDeckBtn = page.getByRole('button', { name: 'New deck', exact: true });
      await expect(newDeckBtn).toBeVisible({ timeout: 5_000 });
      await newDeckBtn.click();

      const nameInput = page.getByLabel('New deck name');
      await expect(nameInput).toBeVisible();
      await nameInput.fill(SECOND_DECK);
      await page.getByRole('button', { name: 'Confirm create deck' }).click();

      // Wait for the new deck to appear in the list and open in the canvas.
      const newDeckButton = page.locator('ul button', { hasText: SECOND_DECK });
      await expect(newDeckButton).toBeVisible({ timeout: 10_000 });
      await waitForCanvasReady(page);

      // The new deck opens at slide 1 (section 0 = .present).
      await expect(
        slidesFrame(page).locator('.reveal .slides > section').nth(0),
      ).toHaveClass(/present/, { timeout: 8_000 });

      // ── 3. Switch back to the smoke deck ──────────────────────────────────
      const smokeDeckBtn = page.locator('ul button', { hasText: SMOKE_DECK });
      await expect(smokeDeckBtn).toBeVisible({ timeout: 5_000 });
      await smokeDeckBtn.click();

      // Wait for the canvas to reload with the smoke deck.
      await waitForCanvasReady(page);

      // ── 4. Assert smoke-deck opened at slide 1, NOT the previously-viewed 2 ──
      // A deck switch changes deckUrl, which rebuilds the {#key} block without
      // setting pendingRestore — so reveal starts fresh at slide 0 (slide 1 UI).
      await expect(
        slidesFrame(page).locator('.reveal .slides > section').nth(0),
      ).toHaveClass(/present/, { timeout: 8_000 });

      // Extra guard: slide 2 must NOT be .present.
      await expect(
        slidesFrame(page).locator('.reveal .slides > section').nth(1),
      ).not.toHaveClass(/present/);
    },
  );
});
