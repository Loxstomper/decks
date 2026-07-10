/**
 * e2e/slide-layouts.spec.ts — Layout presets: new-slide-from-layout,
 * change-layout-preserves-content, and user-template visibility in the picker
 * (P14-3 / P14-4 / P14-6a / P14-6b / P14-7).
 *
 * WHAT IS TESTED:
 * ===============
 *  1. new-slide-from-layout: Opening the Navigator layout-picker dropdown (the
 *     "▾" button beside "+ Slide") and selecting a preset inserts a new slide
 *     carrying that layout's `data-layout` marker and its starter content.
 *
 *  2. change-layout-preserves-content: Right-clicking a slide's Navigator row
 *     → "Change layout" submenu → picking a preset re-flows the slide WITHOUT
 *     dropping any content elements the user had authored.
 *
 *  3. user-template-in-picker: A `templates/foo.html` snippet written to the
 *     workspace `templates/` directory appears as a selectable option in the
 *     Navigator layout-picker alongside the bundled built-in presets.
 *
 * SETUP DEPENDENCY:
 * =================
 * This spec scaffolds and owns its own deck (see fixtures.ts — specs never share a
 * deck). Global setup creates the temp workspace and records its path in
 * `.e2e-state.json`; test 3 reads that to know where to write the template file.
 *
 * CANNOT RUN WITHOUT THE BUILT BINARY:
 * =====================================
 * This is an e2e spec; it requires the `decks` binary + a running server.
 * Run with:
 *   npm run test:e2e
 * or in Docker:
 *   npm run test:e2e:docker
 *
 * The spec CANNOT be executed with `npx vitest run` — Playwright and vitest
 * are separate harnesses (see playwright.config.ts).
 *
 * TYPE-CHECK (without a running browser):
 *   cd web && npx tsc -p e2e/tsconfig.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

import {
  appendSlides,
  createDeck,
  getDeckHtml,
  menuItem,
  openDeckInEditor,
  putDeckHtml,
  thumbnailSrcdocs,
  workspaceDir,
} from './fixtures.ts';

/** This spec's private deck. Never share a deck between spec files. */
const DECK = 'e2e-slide-layouts';

// Stable eid prefix for slides injected by THIS spec — unique per test so
// reruns and parallel (serial workers) don't collide.
const CONTENT_EID_H  = 'e2e-layout-h-p14';    // <h2> inside the content slide
const CONTENT_EID_P  = 'e2e-layout-p-p14';    // <p>  inside the content slide
const CONTENT_SLIDE  = 'e2e-layout-slide-p14'; // the section itself

// The user-template name (sans extension) that test 3 writes to templates/.
const USER_TEMPLATE_NAME = 'e2e-foo-p14';


// ── Setup: ensure the content slide exists before test 2 runs ─────────────────

/** The <h2> text of the injected content slide. Thumbnails carry no eid (the
 *  clone strips them), so this text is how we locate the slide's navigator row. */
const CONTENT_TITLE = 'Authored title';

test.beforeAll(async () => {
  await createDeck(DECK);
  let html = await getDeckHtml(DECK);

  // Idempotent: only inject the content slide once (handles reruns against a
  // persisted workspace).
  if (!html.includes(`data-eid="${CONTENT_SLIDE}"`)) {
    // A minimal well-formed slide with two known-eid leaves inside a container,
    // so "Change layout" has real authored content that it must not drop (P14-4).
    const newSlide =
      `<section data-eid="${CONTENT_SLIDE}">` +
      `<div data-eid="e2e-c-p14" data-lay="stack">` +
      `<h2 data-eid="${CONTENT_EID_H}">${CONTENT_TITLE}</h2>` +
      `<p data-eid="${CONTENT_EID_P}">Authored body</p>` +
      `</div>` +
      `</section>`;
    html = appendSlides(html, newSlide);
    await putDeckHtml(DECK, html);
  }
});

// ── Navigator helpers ─────────────────────────────────────────────────────────

/**
 * Index of the navigator row whose thumbnail renders `text`.
 *
 * Rows carry no `data-eid`, and neither do thumbnails (`applyThumbnailLayout`
 * clones through `cloneSubtreeStripEids`), so matching the rendered text is the
 * only stable way to correlate a row with a slide. Resolved dynamically rather
 * than hard-coded, because earlier tests in this file insert slides.
 *
 * `thumbnailSrcdocs()` scrolls every row into view first — thumbnails are
 * IntersectionObserver-gated and offscreen rows never build a srcdoc.
 */
async function navigatorRowShowing(
  page: import('@playwright/test').Page,
  text: string,
): Promise<number> {
  const srcdocs = await thumbnailSrcdocs(page);
  const index = srcdocs.findIndex((s) => s.includes(text));
  expect(index, `no navigator row whose thumbnail renders "${text}"`).toBeGreaterThanOrEqual(0);
  return index;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Open the Navigator layout-picker dropdown (the "▾" button next to "+ Slide")
 * and wait until at least one preset option is visible.
 * Returns once the popup is open and the first `.layout-picker-item` is attached.
 */
async function openLayoutPicker(page: import('@playwright/test').Page): Promise<void> {
  const arrowBtn = page.locator('[aria-label="Pick layout for new slide"]');
  await expect(arrowBtn).toBeVisible({ timeout: 8_000 });
  await arrowBtn.click();
  // Wait for the popup to appear.
  await expect(page.locator('.layout-picker-popup')).toBeVisible({ timeout: 5_000 });
  // Wait for at least one real preset to load (beyond the "Blank" placeholder).
  await expect(page.locator('.layout-picker-item').first()).toBeVisible({ timeout: 8_000 });
}

// ── Test 1: new-slide-from-layout ────────────────────────────────────────────

test(
  'new-slide-from-layout inserts preset structure + starter content (P14-3)',
  async ({ page }) => {
    await openDeckInEditor(page, DECK);
    await openLayoutPicker(page);

    // Pick the "Title body" preset (built-in bundled preset, data-layout="title-body").
    // The label is "Title body" — derived from the file-name "title-body.html" by
    // layoutLabel() in layouts.go (caps first letter, replaces hyphens with spaces).
    const titleBodyItem = page.locator('.layout-picker-item', { hasText: /^Title body$/i });
    await expect(titleBodyItem).toBeVisible({ timeout: 5_000 });

    // Intercept the autosave PUT that follows the layout insertion.
    const putPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/decks/${encodeURIComponent(DECK)}`) &&
        resp.request().method() === 'PUT',
      { timeout: 10_000 },
    );

    await titleBodyItem.click();
    await putPromise;

    // ── Verify the new slide landed on disk ────────────────────────────────────
    const html = await getDeckHtml(DECK);

    // The preset section must carry its layout marker.
    expect(html, 'new slide should carry data-layout="title-body"').toContain(
      'data-layout="title-body"',
    );

    // The preset's starter prompts should be present (the slide was added to an
    // existing deck but we chose a layout with a content slot, so its starter
    // content appears before the user edits it).
    expect(html, 'new slide should contain the content slot').toContain('data-slot="content"');

    // The whole deck must still have unique eids (no collisions after stamping).
    const eids = [...html.matchAll(/data-eid="([^"]+)"/g)].map((m) => m[1]);
    expect(
      new Set(eids).size,
      'all data-eid values in the deck should be unique after insert',
    ).toBe(eids.length);
  },
);

// ── Test 2: change-layout-preserves-content ──────────────────────────────────

test(
  'change-layout on a non-empty slide preserves all content (P14-4)',
  async ({ page }) => {
    // `slideMenuItems()` renders "Change layout" DISABLED until the preset list
    // resolves, and that disabled state is baked in when the menu opens — retrying
    // the assertion would never recover. `ensurePresets()` fires on mount, so wait
    // for its response before opening any menu. Registered before we navigate.
    const presetsLoaded = page.waitForResponse(
      (resp) => resp.url().includes('/api/templates') && resp.ok(),
      { timeout: 12_000 },
    );
    await openDeckInEditor(page, DECK);
    await presetsLoaded;

    const frame = page.frameLocator('iframe.reveal-frame-iframe');
    await expect(frame.locator(`section[data-eid="${CONTENT_SLIDE}"]`)).toBeAttached({
      timeout: 12_000,
    });

    // ── Open the slide menu from the Navigator row ────────────────────────────
    // The navigator row is a first-class trigger surface for the slide menu (spec
    // canvas-interaction: "the canvas … and the outline panel rows share one menu
    // and one action registry"), and `onRowContextMenu` jumps to the slide *and*
    // targets it by eid in a single gesture.
    //
    // This test used to right-click the canvas instead: advance reveal with
    // ArrowRight, then right-click `.reveal .slides section` *.first()*. But
    // `.first()` is slide 1 — once reveal advances, that section is translated
    // off-screen, the click never reaches the iframe's contextmenu handler, and no
    // menu ever opened. Hence the test had never passed.
    const rowIndex = await navigatorRowShowing(page, CONTENT_TITLE);
    await page.locator('.slide-row[role="option"]').nth(rowIndex).click({ button: 'right' });

    // ── The slide-level context menu should open ───────────────────────────────
    await expect(page.locator('.cm-menu[role="menu"]').first()).toBeVisible({ timeout: 5_000 });

    const changeLayoutItem = menuItem(page, 'Change layout');
    await expect(changeLayoutItem).toBeVisible({ timeout: 5_000 });
    await expect(changeLayoutItem, 'presets must be loaded, else the item is inert').toBeEnabled();

    // ── Hover the "Change layout" item to open its submenu ────────────────────
    await changeLayoutItem.hover();
    // The submenu renders inline; wait for a nested .cm-menu--sub to appear.
    const submenu = page.locator('.cm-menu--sub').first();
    await expect(submenu).toBeVisible({ timeout: 5_000 });

    // Pick "Title body" from the submenu.
    const titleBodySub = menuItem(page, 'Title body');
    await expect(titleBodySub).toBeVisible({ timeout: 5_000 });

    // Intercept the autosave PUT.
    const putPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/decks/${encodeURIComponent(DECK)}`) &&
        resp.request().method() === 'PUT',
      { timeout: 10_000 },
    );

    await titleBodySub.click();
    await putPromise;

    // ── Verify the authored content survived the layout swap ──────────────────
    const html = await getDeckHtml(DECK);

    // The layout marker was updated.
    expect(html, 'slide should now carry data-layout="title-body"').toContain(
      'data-layout="title-body"',
    );

    // The authored content elements must still exist (nothing dropped — P14-4).
    expect(html, 'authored <h2> must survive layout change').toContain(
      `data-eid="${CONTENT_EID_H}"`,
    );
    expect(html, 'authored <p> must survive layout change').toContain(
      `data-eid="${CONTENT_EID_P}"`,
    );

    // The slide's identity (its section data-eid) is preserved.
    expect(html, 'section eid identity must be preserved after layout change').toContain(
      `data-eid="${CONTENT_SLIDE}"`,
    );

    // The authored content should be INSIDE the content slot now.
    const slotIdx = html.indexOf('data-slot="content"');
    expect(slotIdx, 'data-slot="content" must exist in the re-flowed section').toBeGreaterThan(-1);
    const sectionEndIdx = html.indexOf('</section>', slotIdx);
    const slotRegion = html.slice(slotIdx, sectionEndIdx);
    expect(slotRegion, 'authored h2 eid should be inside the content slot').toContain(
      `data-eid="${CONTENT_EID_H}"`,
    );
    expect(slotRegion, 'authored p eid should be inside the content slot').toContain(
      `data-eid="${CONTENT_EID_P}"`,
    );
  },
);

// ── Test 3: user-template appears in the picker ───────────────────────────────

test(
  'user templates/foo.html snippet appears in the layout picker (P14-2 / P14-6a)',
  async ({ page }) => {
    // ── Write the user-template file into the workspace templates/ dir ────────
    // The workspace path is in the state file written by global-setup.
    const templatesDir = join(workspaceDir(), 'templates');
    mkdirSync(templatesDir, { recursive: true });

    const snippetName = USER_TEMPLATE_NAME;
    const snippetHtml =
      `<section data-layout="${snippetName}">` +
      `<div data-lay="stack" data-slot="content" data-gap="24">` +
      `<h2>My custom layout</h2>` +
      `</div>` +
      `</section>`;

    writeFileSync(join(templatesDir, `${snippetName}.html`), snippetHtml, 'utf8');

    // ── Open the editor and the layout picker ─────────────────────────────────
    // `layoutPresets` caches the GET /api/templates response after the first fetch,
    // so open once, then re-open (a fresh page load re-fetches) to pick up the file
    // we just wrote.
    await openDeckInEditor(page, DECK);
    await openDeckInEditor(page, DECK);

    await openLayoutPicker(page);

    // ── The user-template label must appear as a picker item ──────────────────
    // layoutLabel() for "e2e-foo-p14" → "E2e foo p14" (first char capitalised,
    // hyphens replaced with spaces). We use a partial match to avoid hard-coding
    // the exact capitalisation rule.
    const userItem = page.locator('.layout-picker-item', {
      hasText: new RegExp(snippetName.replace(/-/g, '.'), 'i'),
    });
    await expect(userItem, `"${snippetName}" should appear in the layout picker`).toBeVisible({
      timeout: 8_000,
    });

    // The built-in "Title body" item must still be present alongside the user one.
    const builtInItem = page.locator('.layout-picker-item', { hasText: /^Title body$/i });
    await expect(builtInItem, 'built-in "Title body" should still appear in the picker').toBeVisible(
      { timeout: 5_000 },
    );
  },
);
