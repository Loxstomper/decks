/**
 * e2e/free-position.spec.ts — Playwright spec for P15-5 (free-element overlay
 * alignment + drag-to-move coordinate identity).
 *
 * WHAT IS TESTED:
 * ===============
 *  1. After selecting a [data-free] element the FreeTransformOverlay's move-frame
 *     box is aligned with the element's rendered position within a small tolerance.
 *     This verifies P15-2/3: center:false + margin:0 + full-canvas containing block
 *     make logical coordinates match measured screen coordinates at any zoom.
 *
 *  2. Dragging the move-frame updates the element's on-disk data-x / data-y via
 *     the autosave PUT.  The new values change in the direction of the drag (logical
 *     coordinate identity property: screen-space drag delta → correct logical delta).
 *
 * SETUP:
 * ======
 * Global setup creates one "smoke-deck" with two plain slides.  This spec's
 * beforeAll injects a [data-free] element into the first slide via the PUT API so
 * the overlay can be exercised without rebuilding the binary or changing the
 * scaffold template.  The injected HTML is intentional: it exercises the "free
 * element with explicit data-x/y/w/h" path that P15 targets.
 *
 * CANNOT RUN WITHOUT THE BUILT BINARY:
 * =====================================
 * This is an e2e spec; it requires the `decks` binary + a running server.
 * Run it with:
 *   npm run test:e2e
 * or in Docker:
 *   npm run test:e2e:docker
 *
 * The spec CANNOT be executed with `npx vitest run` — Playwright and vitest are
 * separate harnesses (see playwright.config.ts).
 */

import { test, expect } from '@playwright/test';

// Keep in sync with global-setup.ts SMOKE_DECK constant.
const SMOKE_DECK = 'smoke-deck';
const FREE_EID = 'e2e-free-p15';

// Logical coords for the injected free element — easy round numbers for diff checking.
const FREE_X = 200;
const FREE_Y = 150;
const FREE_W = 300;
const FREE_H = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Parse `data-x` or `data-y` out of the raw deck HTML for the element with
 * the given data-eid.  Returns NaN when the attribute is absent.
 */
function parseAttr(html: string, eid: string, attr: string): number {
  // Match data-eid="<eid>" then look for attr="<value>" anywhere in the same tag.
  const tagRe = new RegExp(`<[^>]*data-eid="${eid}"[^>]*>`, 's');
  const tag = tagRe.exec(html)?.[0] ?? '';
  const valRe = new RegExp(`${attr}="([^"]+)"`);
  const val = valRe.exec(tag)?.[1];
  return val !== undefined ? parseFloat(val) : NaN;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

test.beforeAll(async ({ baseURL }) => {
  /**
   * Inject a free element into the first <section> of the smoke deck.
   * We splice the element before the closing </section> tag so it lives
   * inside the first slide and gets an absolute-positioned CSS transform
   * from decks-layout-init.js.
   *
   * data-x/y/w/h are explicit so FreeTransformOverlay uses the attribute
   * values (not a measured fallback) — making the logical→screen math
   * deterministic for our overlay-alignment assertion.
   */
  const baseUrl = baseURL ?? 'http://localhost:19999';
  let html = await getDeckHtml(baseUrl, SMOKE_DECK);

  if (html.includes(`data-eid="${FREE_EID}"`)) {
    // Already injected (e.g. spec re-run without restarting server).
    return;
  }

  const freeEl =
    `<div data-free data-eid="${FREE_EID}" ` +
    `data-x="${FREE_X}" data-y="${FREE_Y}" ` +
    `data-w="${FREE_W}" data-h="${FREE_H}">Free element</div>`;

  // Insert before the first </section>.
  html = html.replace('</section>', `${freeEl}</section>`);
  await putDeckHtml(baseUrl, SMOKE_DECK, html);
});

// ── Shared setup: open the editor and wait for the deck to render ─────────────

/** Navigate to the editor root and wait for the smoke deck's canvas to be ready. */
async function openEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  // The iframe is hidden (visibility:hidden) while loading and becomes visible
  // once handleLoad() fires and isLoading is set to false.
  await expect(page.locator('iframe.reveal-frame-iframe')).toBeVisible({ timeout: 12_000 });
  // Confirm reveal rendered at least one slide inside the iframe.
  await expect(
    page.frameLocator('iframe.reveal-frame-iframe').locator('.reveal .slides section').first(),
  ).toBeAttached({ timeout: 10_000 });
}

// ── Test 1: overlay alignment ─────────────────────────────────────────────────

test(
  'free-transform overlay move-frame aligns with the free element (P15-5)',
  async ({ page }) => {
    await openEditor(page);

    // ── 1. Click the free element inside the iframe to select it ──────────────
    // CanvasInteraction attaches a click handler to the iframe's document.
    // Playwright resolves the frameLocator and clicks the element in the
    // iframe's coordinate space, accounting for the iframe's CSS transform.
    const freeLocator = page
      .frameLocator('iframe.reveal-frame-iframe')
      .locator(`[data-eid="${FREE_EID}"]`);

    await expect(freeLocator).toBeAttached({ timeout: 10_000 });
    await freeLocator.click();

    // ── 2. Wait for the move-frame handle to appear ──────────────────────────
    // FreeTransformOverlay renders a .move-frame div once a single free element
    // is selected (freeSelected = true + baseRect measured).
    const moveFrame = page.locator('.move-frame');
    await expect(moveFrame).toBeVisible({ timeout: 5_000 });

    // ── 3. Compare bounding boxes ─────────────────────────────────────────────
    // Both boxes are measured in viewport (page) coordinates.  The element
    // box comes from Playwright's frameLocator, which accounts for the iframe's
    // CSS transform; the move-frame box comes from the parent-page overlay.
    const elemBox = await freeLocator.boundingBox();
    const overlayBox = await moveFrame.boundingBox();

    expect(elemBox, 'element bounding box should be non-null').not.toBeNull();
    expect(overlayBox, 'move-frame bounding box should be non-null').not.toBeNull();

    if (!elemBox || !overlayBox) return; // TypeScript narrowing

    // Tolerance: 4px covers sub-pixel rendering differences and Playwright's
    // fractional rounding for CSS-transformed iframes.
    const TOL = 4;
    // Playwright's boundingBox() returns { x, y, width, height } in viewport coords.
    expect(Math.abs(overlayBox.x - elemBox.x)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(overlayBox.y - elemBox.y)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(overlayBox.width - elemBox.width)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(overlayBox.height - elemBox.height)).toBeLessThanOrEqual(TOL);
  },
);

// ── Test 2: drag updates on-disk data-x / data-y ──────────────────────────────

test(
  'dragging the move-frame writes updated data-x/y to disk (P15-5)',
  async ({ page, baseURL }) => {
    await openEditor(page);

    // Select the free element.
    const freeLocator = page
      .frameLocator('iframe.reveal-frame-iframe')
      .locator(`[data-eid="${FREE_EID}"]`);
    await expect(freeLocator).toBeAttached({ timeout: 10_000 });
    await freeLocator.click();

    const moveFrame = page.locator('.move-frame');
    await expect(moveFrame).toBeVisible({ timeout: 5_000 });

    // Record the initial on-disk data-x/y.
    const baseUrl = baseURL ?? 'http://localhost:19999';
    const htmlBefore = await getDeckHtml(baseUrl, SMOKE_DECK);
    const xBefore = parseAttr(htmlBefore, FREE_EID, 'data-x');
    const yBefore = parseAttr(htmlBefore, FREE_EID, 'data-y');
    expect(xBefore).not.toBeNaN();
    expect(yBefore).not.toBeNaN();

    // ── Perform a drag on the move-frame ─────────────────────────────────────
    // Drag right+down by a reasonably large amount (≥ any grid snap increment).
    // The drag is in SCREEN pixels; the store converts via transform.scale before
    // writing logical data-x/y, so the on-disk delta will be smaller.
    const box = await moveFrame.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const dragDx = 120; // screen px — positive → right → data-x increases
    const dragDy = 80;  // screen px — positive → down  → data-y increases

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Intercept the autosave PUT so we know when the commit has landed on disk.
    const putPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/decks/${encodeURIComponent(SMOKE_DECK)}`) &&
        resp.request().method() === 'PUT',
      { timeout: 10_000 },
    );

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + dragDx, startY + dragDy, { steps: 10 });
    await page.mouse.up();

    // Wait for the autosave to complete.
    await putPromise;

    // ── Assert data-x/y increased on disk ─────────────────────────────────────
    const htmlAfter = await getDeckHtml(baseUrl, SMOKE_DECK);
    const xAfter = parseAttr(htmlAfter, FREE_EID, 'data-x');
    const yAfter = parseAttr(htmlAfter, FREE_EID, 'data-y');

    expect(xAfter).not.toBeNaN();
    expect(yAfter).not.toBeNaN();

    // The logical delta = screen delta / scale.  We don't know the exact scale
    // (it depends on the browser window size) but a rightward drag MUST increase
    // data-x and a downward drag MUST increase data-y.
    expect(xAfter).toBeGreaterThan(xBefore);
    expect(yAfter).toBeGreaterThan(yBefore);
  },
);
