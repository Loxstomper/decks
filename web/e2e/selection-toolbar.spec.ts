/**
 * e2e/selection-toolbar.spec.ts — Floating selection toolbar, font-size picker
 * (P17-7 regression).
 *
 * WHAT IS TESTED (and WHY here, against the built binary + editor SPA):
 * ===================================================================
 * The font-size control in the selection toolbar (SelectionToolbar.svelte) was
 * a native <select>. Every toolbar control does onmousedown+preventDefault to
 * keep the iframe contenteditable focused (a blur tears down the edit session),
 * but preventDefault on a <select>'s mousedown ALSO stops Chromium from opening
 * the dropdown — so the picker silently did nothing: no option could be chosen,
 * onchange never fired, and no <span style="font-size:…"> was ever written.
 *
 * It is now a custom button menu that reuses the same focus-holding path the
 * B/I/U buttons use. This spec is the end-to-end proof that picking a size in a
 * real browser actually wraps the selection in a font-size run and that the run
 * survives the sanitizing writeback to disk (the model unit suite covers the
 * pure applySpanStyle/serializer logic; this proves the UI wiring).
 *
 * CANNOT RUN WITHOUT THE BUILT BINARY (Playwright, not vitest):
 *   npm run test:e2e        (or npm run test:e2e:docker)
 * Type-check without running:
 *   cd web && npx tsc -p e2e/tsconfig.json
 */

import { test, expect } from '@playwright/test';

// Keep in sync with global-setup.ts SMOKE_DECK constant.
const SMOKE_DECK = 'smoke-deck';
// Stable eid so re-runs are idempotent (we only inject the slide once).
const SIZE_EID = 'e2e-fontsize-tb';

// ── Helpers (mirror free-position.spec.ts / phase17.spec.ts) ──────────────────

async function getDeckHtml(baseUrl: string, deck: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/decks/${encodeURIComponent(deck)}`);
  if (!res.ok) throw new Error(`GET /api/decks/${deck} → ${res.status}`);
  return res.text();
}

async function putDeckHtml(baseUrl: string, deck: string, html: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/decks/${encodeURIComponent(deck)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/html' },
    body: html,
  });
  if (!res.ok) throw new Error(`PUT /api/decks/${deck} → ${res.status}`);
}

/** Extract the inner HTML of the <p data-eid="<eid>">…</p> leaf, or '' if absent. */
function leafInner(html: string, eid: string): string {
  const re = new RegExp(`<p[^>]*data-eid="${eid}"[^>]*>([\\s\\S]*?)</p>`);
  return re.exec(html)?.[1] ?? '';
}

/**
 * Open the editor on the smoke deck. The SPA opens the alphabetically-first deck
 * by default (App.svelte loads decks[0]); other specs in the suite create decks
 * that sort before "smoke-deck", so we must explicitly select it via the deck
 * switcher rather than relying on the default.
 */
async function openEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  const deckBtn = page.locator('ul button', { hasText: SMOKE_DECK });
  await expect(deckBtn).toBeVisible({ timeout: 10_000 });
  await deckBtn.click();
  await expect(page.locator('iframe.reveal-frame-iframe')).toBeVisible({ timeout: 12_000 });
}

// ── Setup: a plain text leaf on the FIRST (always-visible) slide ──────────────
//
// The leaf must live on slide 1: reveal.js only renders the CURRENT slide, so a
// leaf on any other slide is not interactable. We inject into the first existing
// <section> (matching free-position.spec.ts) rather than prepending a new slide,
// because other specs also prepend slides and would push ours out of view.
//
// beforeEach (not beforeAll) so the leaf is reset to plain text before every run
// — the test itself writes a font-size run into it, and we want repeatability.
test.beforeEach(async ({ baseURL }) => {
  const baseUrl = baseURL ?? 'http://localhost:19999';
  let html = await getDeckHtml(baseUrl, SMOKE_DECK);
  const plain = `<p data-eid="${SIZE_EID}">Resize this text</p>`;
  if (html.includes(`data-eid="${SIZE_EID}"`)) {
    // Reset any prior edit (e.g. a font-size span run) back to the plain leaf.
    html = html.replace(new RegExp(`<p[^>]*data-eid="${SIZE_EID}"[^>]*>[\\s\\S]*?</p>`), plain);
  } else {
    html = html.replace('</section>', `${plain}</section>`); // into the first slide
  }
  await putDeckHtml(baseUrl, SMOKE_DECK, html);
});

// ── Test ──────────────────────────────────────────────────────────────────────

test.describe('Selection toolbar — font size (P17-7)', () => {
  test('picking a size wraps the selection in a font-size run and saves it', async ({
    page,
    baseURL,
  }) => {
    const baseUrl = baseURL ?? 'http://localhost:19999';

    // Sanity: the leaf starts with no inline font-size run.
    expect(leafInner(await getDeckHtml(baseUrl, SMOKE_DECK), SIZE_EID)).not.toContain('font-size');

    await openEditor(page);

    // Double-click the leaf → enter edit + select all its contents. It is on the
    // first slide, so reveal renders it as the current (visible) slide.
    const leaf = page.frameLocator('iframe.reveal-frame-iframe').locator(`[data-eid="${SIZE_EID}"]`);
    await expect(leaf).toBeVisible({ timeout: 10_000 });
    await leaf.dblclick();

    // The floating toolbar (rendered in the parent page overlay) appears over the
    // selection. Re-assert the whole leaf is selected (the native dblclick may
    // collapse to a word) so the run wraps the full text deterministically.
    const toolbar = page.locator('.sel-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('ControlOrMeta+a');

    // Open the custom font-size menu and pick "Large" (1.5em).
    await toolbar.locator('.st-size-trigger').click();
    const menu = toolbar.locator('.st-menu');
    await expect(menu).toBeVisible({ timeout: 2_000 });

    // Picking applies the run, commits via applyRichTextEdit → autosave PUT.
    const putPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/decks/${encodeURIComponent(SMOKE_DECK)}`) &&
        resp.request().method() === 'PUT',
      { timeout: 10_000 },
    );
    await menu.getByRole('option', { name: 'Large' }).click();
    await putPromise;

    // The on-disk leaf now carries a sanitized font-size span run.
    const inner = leafInner(await getDeckHtml(baseUrl, SMOKE_DECK), SIZE_EID);
    expect(inner).toContain('<span');
    expect(inner).toMatch(/font-size:\s*1\.5em/);

    // …AND the canvas iframe must reflect it after the reload. The canvas reloads
    // deck.html on save; if that response is served stale (a 304 from the
    // 1-second Last-Modified granularity — deck.html is no-store to prevent this),
    // the run shows on disk + in the present route but NOT in the canvas. Assert
    // the rendered span exists and its computed size is ~1.5× the leaf base.
    const rendered = page
      .frameLocator('iframe.reveal-frame-iframe')
      .locator(`[data-eid="${SIZE_EID}"] span`);
    await expect(rendered).toBeVisible({ timeout: 8_000 });
    const ratio = await rendered.evaluate((span) => {
      // evaluate runs in the browser; reach DOM globals via globalThis (the e2e
      // tsconfig has no DOM lib). The span is the run; its parent is the leaf.
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const gcs = (globalThis as any).getComputedStyle as (el: any) => { fontSize: string };
      const leafPx = parseFloat(gcs((span as any).parentElement).fontSize);
      const spanPx = parseFloat(gcs(span).fontSize);
      return spanPx / leafPx;
    });
    expect(ratio).toBeGreaterThan(1.4);
    expect(ratio).toBeLessThan(1.6);
  });
});
