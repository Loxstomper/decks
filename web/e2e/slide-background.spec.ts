/**
 * e2e/slide-background.spec.ts — Slide image-background fidelity (P16-6).
 *
 * WHAT IS TESTED:
 * ===============
 *  1. Canvas (editor iframe): reveal.js creates .slide-background-content elements
 *     with inline background-image set to the deck-relative asset URL for any slide
 *     carrying data-background-image.  Verified by inspecting every
 *     .slide-background-content element inside the canvas iframe and confirming at
 *     least one references our local SVG asset.
 *
 *  2. Present route (/present/<name>/): same assertion in the standalone reveal
 *     instance served for live presentation.  PDF export (handleExportPDF) drives
 *     the same URL with ?print-pdf, so passing here proves PDF fidelity too.
 *
 *  3. Navigator thumbnail: thumbnail.ts (P16-4) inlines background-image as a CSS
 *     rule on the section in the script-free srcdoc.  Verified by reading the
 *     srcdoc attribute of every iframe.thumb-frame in the editor page, finding the
 *     one whose heading identifies our slide, and confirming it carries the asset
 *     file name while the plain slide's thumbnail does not.  No need to enter the
 *     sandboxed frame.  (Thumbnails carry no data-eid — the clone strips them.)
 *
 *  4. Offline guard: the present route must make zero external http(s) requests even
 *     when a background-image slide is in the deck (the asset is local — spec principles-and-invariants /
 *     P9-2 invariant).
 *
 *  5. Vertical-stack cascade (P16-5 + propagateVerticalBackground in
 *     decks-layout-init.js): a vertical-stack section carrying data-background-*
 *     attributes propagates each attribute to child sections that lack it, before
 *     Reveal.initialize() builds its background layer.  The cascade is per-attribute
 *     — a child with its own value for a specific attribute keeps that value (inner
 *     override wins), while still inheriting other attributes from the stack that it
 *     does not itself carry.
 *
 * CASCADE TEST STRUCTURE:
 * =======================
 *   <section data-eid="e2e-bg-stack-p16"
 *            data-background-image="assets/test-bg.svg"
 *            data-background-color="#334455">          ← stack (outer)
 *     <section data-eid="e2e-bg-vi-p16">               ← V1: no own attrs
 *     <section data-eid="e2e-bg-vo-p16"                ← V2: own color override
 *              data-background-color="#ff0000">
 *
 *  After propagateVerticalBackground():
 *    V1 → data-background-image = "assets/test-bg.svg"  (propagated from stack)
 *       → data-background-color = "#334455"             (propagated from stack)
 *    V2 → data-background-image = "assets/test-bg.svg"  (propagated; child lacked it)
 *       → data-background-color = "#ff0000"             (kept; inner override wins)
 *
 * SETUP:
 * ======
 * This spec scaffolds and owns its own deck (see fixtures.ts — specs never share a
 * deck). Its beforeAll:
 *   1. Writes a minimal 1×1 SVG to <tmpDir>/decks/<deck>/assets/test-bg.svg
 *      (the image is deck-local — it satisfies the offline guard).
 *   2. Injects three slides into the deck via PUT /api/decks/{name}:
 *      a) A slide with data-background-image="assets/test-bg.svg".
 *      b) A plain slide with no background (for contrast / offline guard).
 *      c) The vertical stack described above.
 *   Injection is idempotent — reruns skip if our eids are already present.
 *
 * CANNOT RUN WITHOUT THE BUILT BINARY:
 * =====================================
 * This spec requires the `decks` binary + a running server.  Run with:
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

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

import {
  appendSlides,
  createDeck,
  deckAssetsDir,
  getDeckHtml,
  openDeckInEditor,
  putDeckHtml,
  thumbnailSrcdocs,
} from './fixtures.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** This spec's private deck. Never share a deck between spec files. */
const DECK = 'e2e-slide-background';

// Unique data-eid values — unique across all e2e specs so reruns / parallel
// spec files don't trample each other.
const BG_IMG_EID       = 'e2e-bg-img-p16';    // horizontal slide: image background
const BG_PLAIN_EID     = 'e2e-bg-plain-p16';  // horizontal slide: no background
const BG_STACK_EID     = 'e2e-bg-stack-p16';  // vertical stack: cascade source
const BG_VERT_INHERIT  = 'e2e-bg-vi-p16';     // vertical child: no own attrs (inherits all)
const BG_VERT_OVERRIDE = 'e2e-bg-vo-p16';     // vertical child: own color (inner override)

// Asset path relative to deck.html (i.e., relative to the deck root directory).
// This MUST be a local path — no http(s):// — so the offline guard passes.
const TEST_ASSET_PATH = 'assets/test-bg.svg';

// data-background-color values used in the cascade test.
const STACK_BG_COLOR    = '#334455'; // on the stack (outer)
const OVERRIDE_BG_COLOR = '#ff0000'; // on V2 (inner override that must not be clobbered)

// Minimal 1×1 red SVG: valid XML, no external deps, survives any browser.
const MINIMAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">' +
  '<rect fill="#c0392b" width="1" height="1"/>' +
  '</svg>';

// ---------------------------------------------------------------------------
// Helpers
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
// Setup: write test asset + inject slides
// ---------------------------------------------------------------------------

/**
 * Write a minimal SVG to the deck's assets/ directory so data-background-image
 * can reference it locally, then inject the three test slides if not present.
 * Idempotent: reruns against a persisted workspace skip re-injection.
 */
test.beforeAll(async () => {
  await createDeck(DECK);

  const assetsDir = deckAssetsDir(DECK);
  mkdirSync(assetsDir, { recursive: true });
  // Write idempotently — overwriting the same content on reruns is fine.
  writeFileSync(join(assetsDir, 'test-bg.svg'), MINIMAL_SVG, 'utf8');

  let html = await getDeckHtml(DECK);
  // Idempotent: if our primary eid is already present the slides are already injected.
  if (html.includes(`data-eid="${BG_IMG_EID}"`)) return;

  // 1. Horizontal slide with a local image background — the primary P16-6 test subject.
  const bgSlide =
    `<section data-eid="${BG_IMG_EID}" ` +
    `data-background-image="${TEST_ASSET_PATH}">` +
    `<h2 data-eid="${BG_IMG_EID}-h">Image background slide</h2>` +
    `</section>`;

  // 2. Plain slide — no background (used by the offline-guard test as a contrast slide).
  const plainSlide =
    `<section data-eid="${BG_PLAIN_EID}">` +
    `<h2>Plain slide (no background)</h2>` +
    `</section>`;

  // 3. Vertical stack — cascade source for the P16-5 tests.
  //    Stack carries BOTH data-background-image AND data-background-color.
  //    V1 (no own attrs) → inherits both from the stack via propagateVerticalBackground.
  //    V2 (own data-background-color) → keeps own color; still inherits missing image attr.
  const stackSlide =
    `<section data-eid="${BG_STACK_EID}" ` +
    `data-background-image="${TEST_ASSET_PATH}" ` +
    `data-background-color="${STACK_BG_COLOR}">` +
    `<section data-eid="${BG_VERT_INHERIT}">` +
    `<h2>V1: inherits all backgrounds from stack</h2>` +
    `</section>` +
    `<section data-eid="${BG_VERT_OVERRIDE}" data-background-color="${OVERRIDE_BG_COLOR}">` +
    `<h2>V2: own color wins; inherits missing image</h2>` +
    `</section>` +
    `</section>`;

  // Append all three as the last slides inside `.slides`. appendSlides() anchors
  // on the final `</section>` and throws when it can't find one — unlike the old
  // `</div></div>` regex, whose first match moved as soon as a fixture slide
  // contained nested divs, silently splicing these sections *inside* a slide.
  html = appendSlides(html, `${bgSlide}\n${plainSlide}\n${stackSlide}`);

  await putDeckHtml(DECK, html);
});

// ---------------------------------------------------------------------------
// Tests — image background rendering (P16-6)
// ---------------------------------------------------------------------------

test.describe('Slide image background — canvas + present + thumbnail + offline (P16-6)', () => {
  /**
   * Canvas (editor iframe): when reveal.js initializes, it reads data-background-image
   * from each section and creates a .slide-background-content element with an inline
   * background-image style.  Verify that at least one such element in the canvas iframe
   * references our local SVG asset.
   *
   * Reveal creates background elements for ALL slides at init time (not just the current
   * one), so we do not need to navigate to the specific slide — any .slide-background-content
   * with the matching URL proves the attribute was parsed and rendered.
   */
  test('canvas: reveal creates .slide-background-content with background-image for image slide', async ({ page }) => {
    await openDeckInEditor(page, DECK);

    const frame = page.frameLocator('iframe.reveal-frame-iframe');
    // Wait for reveal to bootstrap.
    await expect(frame.locator('.reveal')).toBeAttached({ timeout: 10_000 });
    // Wait until reveal has created at least one .slide-background-content element
    // (these are created asynchronously after Reveal.initialize() fires 'ready').
    await expect(frame.locator('.slide-background-content').first()).toBeAttached({
      timeout: 8_000,
    });

    // Collect all inline background-image styles from .slide-background-content elements.
    // Reveal resolves the deck-relative path to an absolute URL, so we only check that
    // the asset file name appears somewhere in the style value.
    const bgImages = await frame.locator('.slide-background-content').evaluateAll(
      (els: any[]) =>
        (els as any[])
          .map((el: any) => (el.style.backgroundImage as string) ?? '')
          .filter((s: string) => s !== ''),
    );

    expect(
      bgImages.some((s: string) => s.includes('test-bg.svg')),
      `Canvas: expected at least one .slide-background-content whose ` +
      `background-image style contains 'test-bg.svg'. ` +
      `Reveal must have parsed data-background-image="${TEST_ASSET_PATH}" ` +
      `on section[data-eid="${BG_IMG_EID}"]. ` +
      `Found styles: ${JSON.stringify(bgImages)}`,
    ).toBe(true);
  });

  /**
   * Present route: same assertion in the standalone reveal instance served at
   * /present/<name>/.  This is the route used for live presentation and, with
   * ?print-pdf, for PDF export — so passing here transitively proves PDF fidelity.
   */
  test('present route: reveal creates .slide-background-content with background-image', async ({ page }) => {
    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });
    // Wait until reveal has created its background layer.
    await page.locator('.slide-background-content').first().waitFor({ timeout: 8_000 });

    const bgImages = await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const doc = (globalThis as any).document as any;
      const els: any[] = Array.from(doc.querySelectorAll('.slide-background-content'));
      return els
        .map((el: any) => el.style.backgroundImage as string)
        .filter((s: string) => s !== '');
    });

    expect(
      (bgImages as string[]).some((s) => s.includes('test-bg.svg')),
      `Present route: expected .slide-background-content with 'test-bg.svg'; ` +
      `found: ${JSON.stringify(bgImages)}`,
    ).toBe(true);
  });

  /**
   * Navigator thumbnail: thumbnail.ts (P16-4) applies the image as a CSS
   * background-image rule on the section inside the script-free srcdoc.
   *
   * The srcdoc is a string attribute on each iframe.thumb-frame in the editor DOM,
   * readable without entering the sandboxed frame (sandbox="" gives an opaque
   * origin, but the attribute lives on the outer page's iframe element).
   *
   * WE CORRELATE BY HEADING TEXT, NOT BY data-eid: `applyThumbnailLayout()` clones
   * the section through `cloneSubtreeStripEids()`, so a thumbnail's srcdoc never
   * carries any data-eid — that is deliberate (eids identify model nodes in the
   * deck document; duplicating them into a second document would be meaningless)
   * and is pinned by thumbnail-layout.test.ts. An earlier version of this test
   * asserted the eid was present and so could never pass.
   *
   * The plain-slide check is the control: it proves the background-image rule is
   * emitted per-slide rather than smeared across every thumbnail.
   */
  test('navigator thumbnail srcdoc contains background-image for image-background slide', async ({ page }) => {
    await openDeckInEditor(page, DECK);
    // Thumbnails are IntersectionObserver-gated: scroll every row into view first,
    // else the rows below the fold report an empty srcdoc.
    const srcdocs = await thumbnailSrcdocs(page);

    const imageSlideThumb = srcdocs.find((s) => s.includes('Image background slide'));
    expect(
      imageSlideThumb,
      `Expected a thumb-frame whose srcdoc renders the image-background slide ` +
      `(its <h2> reads "Image background slide"). Got ${srcdocs.length} thumbnails.`,
    ).toBeDefined();

    expect(
      imageSlideThumb,
      `thumbnail.ts (P16-4) must inline background-image as CSS on the section when ` +
      `data-background-image is set and the path is local (not http://).`,
    ).toContain('test-bg.svg');

    // Control: the no-background slide's thumbnail must NOT carry the image.
    const plainSlideThumb = srcdocs.find((s) => s.includes('Plain slide (no background)'));
    expect(plainSlideThumb, 'expected a thumbnail for the plain slide').toBeDefined();
    expect(
      plainSlideThumb,
      'the plain slide has no data-background-image, so its thumbnail must not reference the asset',
    ).not.toContain('test-bg.svg');
  });

  /**
   * Offline guard: the present route must not fetch any external resources even when
   * a slide carries data-background-image.  The asset is stored locally under
   * assets/test-bg.svg — zero external URLs are needed.
   *
   * This is the P9-2 / spec-12 invariant extended to cover background images.
   */
  test('present route makes no external requests even with image-background slide (offline guard)', async ({ page }) => {
    const externalRequests: string[] = [];

    // Listen BEFORE navigating so we don't miss early requests.
    page.on('request', (req) => {
      if (isExternal(req.url())) externalRequests.push(req.url());
    });

    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });
    // Let any lazy/deferred loads (lazy plugins, font-face, etc.) settle.
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {
      // networkidle can time out on SSE connections — that's expected and fine.
    });

    expect(
      externalRequests,
      `Present route made ${externalRequests.length} external request(s):\n` +
        externalRequests.map((u) => `  • ${u}`).join('\n'),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — vertical background cascade (P16-5)
// ---------------------------------------------------------------------------

test.describe('Vertical background cascade — propagateVerticalBackground() (P16-5)', () => {
  /**
   * propagateVerticalBackground() in decks-layout-init.js runs before
   * Reveal.initialize() and copies each data-background-* attribute from a
   * vertical-stack section to child sections that lack that specific attribute.
   *
   * The cascade is per-attribute and per-child:
   *  - If the stack has data-background-image and the child lacks it → child gets it.
   *  - If the child already has its own data-background-color → child keeps it (inner wins).
   *  - Each attribute is evaluated independently, so a child can override one attr
   *    while still inheriting the others from the stack.
   *
   * All assertions are made on the present route because decks-layout-init.js runs as
   * a <script> tag — the script-free thumbnail iframes do not execute it.
   */

  test('V1 inherits data-background-image from vertical stack (propagateVerticalBackground)', async ({ page }) => {
    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });

    // V1 carries no background attrs of its own; after propagation it must have
    // data-background-image copied from the stack.
    const v1BgImage = await page.evaluate((eid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const doc = (globalThis as any).document as { querySelector(s: string): any };
      const el = doc.querySelector(`section[data-eid="${eid}"]`);
      if (!el) return null;
      return el.getAttribute('data-background-image') as string | null;
    }, BG_VERT_INHERIT);

    expect(v1BgImage, `V1 section[data-eid="${BG_VERT_INHERIT}"] must be present in the DOM`).not.toBeNull();
    expect(
      v1BgImage,
      `V1 must inherit data-background-image="${TEST_ASSET_PATH}" from the stack ` +
      `(propagateVerticalBackground copies it because V1 lacks the attribute)`,
    ).toBe(TEST_ASSET_PATH);
  });

  test('V1 inherits data-background-color from vertical stack (propagateVerticalBackground)', async ({ page }) => {
    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });

    const v1BgColor = await page.evaluate((eid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const doc = (globalThis as any).document as { querySelector(s: string): any };
      const el = doc.querySelector(`section[data-eid="${eid}"]`);
      if (!el) return null;
      return el.getAttribute('data-background-color') as string | null;
    }, BG_VERT_INHERIT);

    expect(v1BgColor, `V1 section must be present in the DOM`).not.toBeNull();
    expect(
      v1BgColor,
      `V1 must inherit data-background-color="${STACK_BG_COLOR}" from the stack ` +
      `(V1 carries no own data-background-color, so propagation applies)`,
    ).toBe(STACK_BG_COLOR);
  });

  test('V2 inner data-background-color override wins (propagation must not overwrite)', async ({ page }) => {
    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });

    // V2 starts with data-background-color="#ff0000" (its own value).
    // The stack has data-background-color="#334455".
    // propagateVerticalBackground must NOT overwrite V2's existing color —
    // the check `if (!child.hasAttribute(attr))` guards this.
    const v2BgColor = await page.evaluate((eid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const doc = (globalThis as any).document as { querySelector(s: string): any };
      const el = doc.querySelector(`section[data-eid="${eid}"]`);
      if (!el) return null;
      return el.getAttribute('data-background-color') as string | null;
    }, BG_VERT_OVERRIDE);

    expect(v2BgColor, `V2 section must be present in the DOM`).not.toBeNull();
    expect(
      v2BgColor,
      `V2 must keep its own data-background-color="${OVERRIDE_BG_COLOR}" ` +
      `(inner override wins — propagateVerticalBackground skips attrs the child already owns). ` +
      `Stack color is "${STACK_BG_COLOR}"; V2 must NOT have been overwritten with that.`,
    ).toBe(OVERRIDE_BG_COLOR);
  });

  test('V2 inherits missing data-background-image from stack (per-attribute cascade)', async ({ page }) => {
    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });

    // V2 has its own data-background-color but no data-background-image.
    // Cascade is per-attribute: each attr is evaluated independently.
    // V2 must inherit data-background-image from the stack even though it
    // overrides data-background-color — the two decisions are orthogonal.
    const v2BgImage = await page.evaluate((eid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const doc = (globalThis as any).document as { querySelector(s: string): any };
      const el = doc.querySelector(`section[data-eid="${eid}"]`);
      if (!el) return null;
      return el.getAttribute('data-background-image') as string | null;
    }, BG_VERT_OVERRIDE);

    expect(v2BgImage, `V2 section must be present in the DOM`).not.toBeNull();
    expect(
      v2BgImage,
      `V2 must inherit data-background-image="${TEST_ASSET_PATH}" from the stack. ` +
      `V2 carries no own data-background-image, so the cascade propagates it. ` +
      `The per-attribute nature means V2's own color override does not block ` +
      `the propagation of the unrelated image attribute.`,
    ).toBe(TEST_ASSET_PATH);
  });
});
