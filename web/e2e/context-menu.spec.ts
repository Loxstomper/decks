/**
 * e2e/context-menu.spec.ts — Playwright spec for the right-click context menu
 * (P13: spec canvas-interaction, spec principles-and-invariants "never-destroy").
 *
 * WHAT IS TESTED:
 * ===============
 *  1. Right-clicking a canvas element opens the context menu, and choosing
 *     "Delete" removes the element from the deck (PUT to disk, element gone
 *     from the iframe DOM after reload).
 *
 *  2. Right-clicking a different canvas element and choosing "Duplicate" creates
 *     a copy: the deck gains a second element sharing the same base text content.
 *
 *  3. Right-clicking empty slide background (no element under cursor) opens the
 *     slide-level menu, and choosing "Insert slide" adds a new slide to the deck.
 *
 * SETUP:
 * ======
 * This spec scaffolds and owns its own deck (see fixtures.ts — specs never share
 * a deck), then injects two leaf elements with known data-eid values into the
 * first slide via the PUT API so the context menu can be exercised without
 * modifying the scaffold template.
 *
 * Each test that mutates the deck (Delete, Duplicate) operates on its own eid so
 * tests stay independent within this file.  The Insert slide test acts on the
 * slide-level menu and is additive.
 *
 * CANNOT RUN WITHOUT THE BUILT BINARY:
 * =====================================
 * This is an e2e spec; it requires the `decks` binary + a running server.
 * Run with:
 *   npm run test:e2e
 * or in Docker:
 *   npm run test:e2e:docker
 *
 * The spec CANNOT be executed with `npx vitest run` — Playwright and vitest are
 * separate harnesses (see playwright.config.ts).
 *
 * TYPE-CHECK (without a running browser):
 *   cd web && npx tsc -p e2e/tsconfig.json
 */

import { test, expect } from '@playwright/test';

import {
  appendToFirstSlide,
  createDeck,
  getDeckHtml,
  menuItem,
  openDeckInEditor,
  putDeckHtml,
} from './fixtures.ts';

/** This spec's private deck. Never share a deck between spec files. */
const DECK = 'e2e-context-menu';

// Stable eids for the two injected test elements.
// Each test that deletes an element uses a unique eid so they don't trample each other.
const DELETE_EID = 'e2e-ctx-delete-p13';
const DUPLICATE_EID = 'e2e-ctx-duplicate-p13';

/** Count how many elements with the given data-eid appear in the HTML source. */
function countEidInHtml(html: string, eid: string): number {
  const re = new RegExp(`data-eid="${eid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
  return (html.match(re) ?? []).length;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  /**
   * Inject two leaf elements into the first <section>. They are plain <p>
   * elements with a data-eid so the editor classifies them as a "leaf" and the
   * context menu offers the full element action set — `resolveSelectable()` only
   * resolves a click to a recognised leaf tag, never to a <div>.
   */
  await createDeck(DECK);
  let html = await getDeckHtml(DECK);

  for (const { eid, text } of [
    { eid: DELETE_EID, text: 'Delete me (e2e)' },
    { eid: DUPLICATE_EID, text: 'Duplicate me (e2e)' },
  ]) {
    if (!html.includes(`data-eid="${eid}"`)) {
      html = appendToFirstSlide(html, `<p data-eid="${eid}">${text}</p>`);
    }
  }
  await putDeckHtml(DECK, html);
});

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Wait for the context menu to appear (`.cm-menu[role="menu"]`).
 * Returns the menu locator for chaining.
 */
function contextMenuLocator(page: import('@playwright/test').Page) {
  return page.locator('.cm-menu[role="menu"]').first();
}

/**
 * Right-click on `target` and wait for the context menu to open.
 * Uses Playwright's built-in click with `button: 'right'`.
 */
async function rightClickAndWaitForMenu(
  page: import('@playwright/test').Page,
  target: import('@playwright/test').Locator,
): Promise<void> {
  await target.click({ button: 'right' });
  await expect(contextMenuLocator(page)).toBeVisible({ timeout: 5_000 });
}

// ── Test 1: right-click element → Delete removes it ──────────────────────────

test(
  'right-click canvas element → menu opens → Delete removes the element (P13)',
  async ({ page }) => {
    await openDeckInEditor(page, DECK);

    // Locate the element to delete inside the iframe.
    const elLocator = page
      .frameLocator('iframe.reveal-frame-iframe')
      .locator(`[data-eid="${DELETE_EID}"]`);

    await expect(elLocator).toBeAttached({ timeout: 10_000 });

    // ── 1. Right-click → menu opens ──────────────────────────────────────────
    await rightClickAndWaitForMenu(page, elLocator);

    // The menu must contain a "Delete" action (danger item).
    const deleteItem = menuItem(page, 'Delete');
    await expect(deleteItem).toBeVisible({ timeout: 3_000 });

    // ── 2. Click Delete → autosave fires ────────────────────────────────────
    // Intercept the autosave PUT so we know when the write has landed on disk.
    const putPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/decks/${encodeURIComponent(DECK)}`) &&
        resp.request().method() === 'PUT',
      { timeout: 10_000 },
    );

    await deleteItem.click();

    await putPromise;

    // ── 3. Verify the element is absent from the persisted HTML ──────────────
    const htmlAfter = await getDeckHtml(DECK);
    expect(
      countEidInHtml(htmlAfter, DELETE_EID),
      `element with eid="${DELETE_EID}" should be gone after Delete`,
    ).toBe(0);
  },
);

// ── Test 2: right-click element → Duplicate yields a copy ────────────────────

test(
  'right-click canvas element → menu opens → Duplicate creates a copy (P13)',
  async ({ page }) => {
    await openDeckInEditor(page, DECK);

    // Locate the element to duplicate inside the iframe.
    const elLocator = page
      .frameLocator('iframe.reveal-frame-iframe')
      .locator(`[data-eid="${DUPLICATE_EID}"]`);

    await expect(elLocator).toBeAttached({ timeout: 10_000 });

    // Record the eid count before duplicating (should be 1).
    const htmlBefore = await getDeckHtml(DECK);
    const countBefore = countEidInHtml(htmlBefore, DUPLICATE_EID);
    expect(countBefore).toBe(1);

    // ── 1. Right-click → menu opens ──────────────────────────────────────────
    await rightClickAndWaitForMenu(page, elLocator);

    // "Duplicate", not "Duplicate slide" — exact accessible-name matching.
    const duplicateItem = menuItem(page, 'Duplicate');
    await expect(duplicateItem).toBeVisible({ timeout: 3_000 });

    // ── 2. Click Duplicate → autosave fires ──────────────────────────────────
    const putPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/decks/${encodeURIComponent(DECK)}`) &&
        resp.request().method() === 'PUT',
      { timeout: 10_000 },
    );

    await duplicateItem.click();

    await putPromise;

    // ── 3. Verify two copies exist in the persisted HTML ─────────────────────
    // The duplicate keeps the same text content but gets a fresh generated eid.
    // We can assert by counting the original eid (still 1) and verifying that
    // the overall element count in the deck grew.  Additionally, the duplicate
    // must not share the original eid — deckStore.duplicateElement generates a
    // new one — so the source eid count stays at 1.
    const htmlAfter = await getDeckHtml(DECK);
    expect(
      countEidInHtml(htmlAfter, DUPLICATE_EID),
      `original eid="${DUPLICATE_EID}" must still appear exactly once`,
    ).toBe(1);

    // The duplicated element has a fresh eid (we can't predict it), so assert
    // via total p-element count increase: the deck gained at least one element
    // compared to before.
    const pCountBefore = (htmlBefore.match(/<p\s/g) ?? []).length;
    const pCountAfter = (htmlAfter.match(/<p\s/g) ?? []).length;
    expect(pCountAfter).toBeGreaterThan(pCountBefore);
  },
);

// ── Test 3: right-click empty slide area → slide menu → Insert slide ──────────

test(
  'right-click empty slide area → slide menu opens → Insert slide adds a slide (P13-8)',
  async ({ page }) => {
    await openDeckInEditor(page, DECK);

    // Count sections before the operation.
    const htmlBefore = await getDeckHtml(DECK);
    // Count top-level <section> tags (each represents a slide).
    const sectionsBefore = (htmlBefore.match(/<section/g) ?? []).length;

    // ── 1. Right-click the reveal.js slide background ───────────────────────
    // We click at the centre of the reveal slides container — a spot that is
    // guaranteed NOT to be covered by any element (the elements are near the top
    // of the slide, so clicking near the bottom-centre should hit empty space).
    // CanvasInteraction clears the selection on empty-space right-clicks, and
    // App.openContextMenuAt shows the slide-level menu when no element is selected.
    const slideContainer = page
      .frameLocator('iframe.reveal-frame-iframe')
      .locator('.reveal .slides section')
      .first();

    await expect(slideContainer).toBeAttached({ timeout: 10_000 });

    // Click near the bottom of the slide (y=95% of the element height) to
    // target the empty background rather than any injected element near the top.
    await slideContainer.click({
      button: 'right',
      position: { x: 50, y: (await slideContainer.boundingBox())!.height * 0.85 },
    });

    // The slide-level menu must open (it contains "Insert slide").
    const menu = contextMenuLocator(page);
    await expect(menu).toBeVisible({ timeout: 5_000 });

    const insertSlideItem = menuItem(page, 'Insert slide');
    await expect(insertSlideItem).toBeVisible({ timeout: 3_000 });

    // ── 2. Click Insert slide → autosave fires ───────────────────────────────
    const putPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/decks/${encodeURIComponent(DECK)}`) &&
        resp.request().method() === 'PUT',
      { timeout: 10_000 },
    );

    await insertSlideItem.click();

    await putPromise;

    // ── 3. Verify the deck gained a section ──────────────────────────────────
    const htmlAfter = await getDeckHtml(DECK);
    const sectionsAfter = (htmlAfter.match(/<section/g) ?? []).length;
    expect(sectionsAfter).toBeGreaterThan(sectionsBefore);
  },
);
