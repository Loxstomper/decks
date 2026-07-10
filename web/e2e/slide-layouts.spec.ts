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
 *  2. change-layout-preserves-content: Right-clicking the empty slide background
 *     → "Change layout" submenu → picking a preset re-flows the slide WITHOUT
 *     dropping any content elements the user had authored.
 *
 *  3. user-template-in-picker: A `templates/foo.html` snippet written to the
 *     workspace `templates/` directory appears as a selectable option in the
 *     Navigator layout-picker alongside the bundled built-in presets.
 *
 * SETUP DEPENDENCY:
 * =================
 * Global setup (e2e/global-setup.ts) creates "smoke-deck" in a fresh temp
 * workspace and writes the temp-dir path + server PID to `.e2e-state.json`.
 * Test 3 reads that state file to know where to write the user-template file.
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

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { STATE_FILE } from './global-setup';

// Keep in sync with global-setup.ts SMOKE_DECK constant.
const SMOKE_DECK = 'smoke-deck';

// Stable eid prefix for slides injected by THIS spec — unique per test so
// reruns and parallel (serial workers) don't collide.
const CONTENT_EID_H  = 'e2e-layout-h-p14';    // <h2> inside the content slide
const CONTENT_EID_P  = 'e2e-layout-p-p14';    // <p>  inside the content slide
const CONTENT_SLIDE  = 'e2e-layout-slide-p14'; // the section itself

// The user-template name (sans extension) that test 3 writes to templates/.
const USER_TEMPLATE_NAME = 'e2e-foo-p14';

// ── API helpers ────────────────────────────────────────────────────────────────

/** Fetch the current deck.html from the API (returns the raw HTML string). */
async function getDeckHtml(baseUrl: string, deckName: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/decks/${encodeURIComponent(deckName)}`);
  if (!res.ok) throw new Error(`GET /api/decks/${deckName} → ${res.status}`);
  return res.text();
}

/** PUT new deck.html to the API. */
async function putDeckHtml(baseUrl: string, deckName: string, html: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/decks/${encodeURIComponent(deckName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/html' },
    body: html,
  });
  if (!res.ok) throw new Error(`PUT /api/decks/${deckName} → ${res.status}`);
}

/** Read the temp-workspace path written by global-setup. */
function readWorkspaceDir(): string {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { tmpDir: string };
  return state.tmpDir;
}

// ── Setup: ensure the content slide exists before test 2 runs ─────────────────

test.beforeAll(async ({ baseURL }) => {
  const baseUrl = baseURL ?? 'http://localhost:19999';
  let html = await getDeckHtml(baseUrl, SMOKE_DECK);

  // Idempotent: only inject the content slide once (handles reruns against a
  // persisted workspace). Insert before the first </section> close tag so the
  // new slide ends up inside the slides container as a top-level section.
  if (!html.includes(`data-eid="${CONTENT_SLIDE}"`)) {
    // Build a minimal well-formed slide with two known-eid leaves.
    const newSlide =
      `<section data-eid="${CONTENT_SLIDE}">` +
      `<div data-eid="e2e-c-p14" data-lay="stack">` +
      `<h2 data-eid="${CONTENT_EID_H}">Authoured title</h2>` +
      `<p data-eid="${CONTENT_EID_P}">Authored body</p>` +
      `</div>` +
      `</section>`;
    // Splice it after the first existing top-level </section> so it appears
    // as a second slide, keeping the existing first slide intact.
    const insertAfter = html.indexOf('</section>');
    if (insertAfter !== -1) {
      html =
        html.slice(0, insertAfter + '</section>'.length) +
        '\n' + newSlide +
        html.slice(insertAfter + '</section>'.length);
    } else {
      // Fallback: prepend to </div> closing the slides container.
      html = html.replace('</div>', newSlide + '</div>');
    }
    await putDeckHtml(baseUrl, SMOKE_DECK, html);
  }
});

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Navigate to the editor root and wait for the smoke deck's canvas to be ready.
 * Returns once the iframe is visible and reveal.js has rendered at least one slide.
 */
async function openEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('iframe.reveal-frame-iframe')).toBeVisible({ timeout: 12_000 });
  await expect(
    page.frameLocator('iframe.reveal-frame-iframe').locator('.reveal .slides section').first(),
  ).toBeAttached({ timeout: 10_000 });
}

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
  async ({ page, baseURL }) => {
    await openEditor(page);
    await openLayoutPicker(page);

    // Pick the "Title body" preset (built-in bundled preset, data-layout="title-body").
    // The label is "Title body" — derived from the file-name "title-body.html" by
    // layoutLabel() in layouts.go (caps first letter, replaces hyphens with spaces).
    const titleBodyItem = page.locator('.layout-picker-item', { hasText: /^Title body$/i });
    await expect(titleBodyItem).toBeVisible({ timeout: 5_000 });

    // Intercept the autosave PUT that follows the layout insertion.
    const putPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/decks/${encodeURIComponent(SMOKE_DECK)}`) &&
        resp.request().method() === 'PUT',
      { timeout: 10_000 },
    );

    await titleBodyItem.click();
    await putPromise;

    // ── Verify the new slide landed on disk ────────────────────────────────────
    const baseUrl = baseURL ?? 'http://localhost:19999';
    const html = await getDeckHtml(baseUrl, SMOKE_DECK);

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
  async ({ page, baseURL }) => {
    await openEditor(page);

    // Navigate to our injected content slide in the Navigator by clicking its
    // thumbnail row. The row carries role="option" and belongs to the Navigator's
    // ol.nav-list; we look for the slide-row that renders the injected section.
    // We navigate by clicking the second slide-row (index 1 if 0-based) since we
    // appended our slide after the first existing slide.
    //
    // Safer: wait for the iframe to render the injected content, then operate.
    // We locate the content slide via the iframe's DOM.
    const frame = page.frameLocator('iframe.reveal-frame-iframe');
    const contentSlide = frame.locator(`section[data-eid="${CONTENT_SLIDE}"]`);

    // Some reveal decks need navigation to reach a non-first slide. We jump to
    // our slide by pressing ArrowRight in the iframe until it's current. But the
    // easiest reliable approach is to click the slide's navigator row.
    //
    // The navigator slide rows are `div.slide-row[role="option"]` inside the ol.
    // We can't predict the index easily, so we wait for the iframe to become
    // attached then use the slide's data-eid presence in the deck source to
    // confirm setup, and then trigger the context menu against it.
    await expect(contentSlide).toBeAttached({ timeout: 12_000 });

    // Click the Navigator row that corresponds to our content slide so it becomes
    // the current canvas slide (required for the slide context menu to target it).
    const navRows = page.locator('.slide-row[role="option"]');
    // Try each row until we find the one whose click brings our eid into the frame.
    // With the setup above, our slide is typically at index 1.
    // We use a more robust approach: navigate via ArrowRight key in the iframe.
    const iframeEl = page.locator('iframe.reveal-frame-iframe');
    await iframeEl.click(); // give focus to the iframe
    // Press ArrowRight once to move to the second slide (our injected content slide).
    // If the deck has more slides before ours, we may need more presses; but in the
    // test setup it's always the second slide.
    await page.keyboard.press('ArrowRight');
    // Wait briefly for reveal to animate.
    await page.waitForTimeout(400);

    // ── Right-click the slide background to open the slide-level context menu ──
    const slideSection = frame.locator('.reveal .slides section').first();
    await expect(slideSection).toBeAttached({ timeout: 8_000 });

    // Click near the bottom of the current slide (away from any element, targeting
    // the empty slide background so the slide-level menu opens rather than the
    // element menu). Mirrors context-menu.spec.ts test 3 pattern.
    const slideBox = await slideSection.boundingBox();
    const clickY = slideBox ? slideBox.height * 0.85 : 300;

    await slideSection.click({
      button: 'right',
      position: { x: 50, y: clickY },
    });

    // ── The slide-level context menu should open ───────────────────────────────
    const menu = page.locator('.cm-menu[role="menu"]').first();
    await expect(menu).toBeVisible({ timeout: 5_000 });

    // "Change layout" item must be present (enabled once presets are loaded).
    const changeLayoutItem = page.locator('.cm-item', { hasText: /^Change layout$/ });
    await expect(changeLayoutItem).toBeVisible({ timeout: 5_000 });

    // ── Hover/click the "Change layout" item to open its submenu ──────────────
    await changeLayoutItem.hover();
    // The submenu renders inline; wait for a nested .cm-menu--sub to appear.
    const submenu = page.locator('.cm-menu--sub').first();
    await expect(submenu).toBeVisible({ timeout: 5_000 });

    // Pick "Title body" from the submenu.
    const titleBodySub = page.locator('.cm-item', { hasText: /^Title body$/i }).last();
    await expect(titleBodySub).toBeVisible({ timeout: 5_000 });

    // Intercept the autosave PUT.
    const putPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/decks/${encodeURIComponent(SMOKE_DECK)}`) &&
        resp.request().method() === 'PUT',
      { timeout: 10_000 },
    );

    await titleBodySub.click();
    await putPromise;

    // ── Verify the authored content survived the layout swap ──────────────────
    const baseUrl = baseURL ?? 'http://localhost:19999';
    const html = await getDeckHtml(baseUrl, SMOKE_DECK);

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
    const workspaceDir = readWorkspaceDir();
    const templatesDir = join(workspaceDir, 'templates');
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
    await openEditor(page);

    // The GET /api/templates response is cached in layoutPresets after the first
    // fetch. We reload so the picker fetches again and picks up the new file.
    await page.reload();
    await expect(page.locator('iframe.reveal-frame-iframe')).toBeVisible({ timeout: 12_000 });

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
