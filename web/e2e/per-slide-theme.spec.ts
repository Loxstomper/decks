/**
 * e2e/per-slide-theme.spec.ts — Per-slide theme fidelity (P10-7 + P10-8).
 *
 * WHAT IS TESTED:
 * ===============
 *  1. A slide with `data-theme="solarized-dark"` shows a different computed
 *     --r-main-color and text color than an adjacent unthemed slide.  This
 *     exercises P10-1's generated decks-slide-themes.css, which scopes
 *     --r-* custom properties to section[data-theme], and CSS inheritance,
 *     which carries those vars into the slide's content nodes.
 *
 *  2. Present/PDF fidelity (P10-8): the assertion is made against the PRESENT
 *     route (/present/{name}/) — not the editor iframe — because that is the
 *     route served for both live presentation and PDF export (?print-pdf).
 *     The present route delegates to os.DirFS(deckDir) and serves deck.html
 *     plus all assets under that directory, including
 *     assets/vendor/decks-slide-themes.css which was written at scaffold time.
 *     PDF export (handleExportPDF) drives headless Chrome against the same URL
 *     with ?print-pdf appended, so scoped CSS vars and backgrounds render
 *     identically in PDFs.
 *
 *  3. Vertical cascade (P10-7): confirm that an inner slide of a vertical
 *     stack inherits --r-main-color from the stack's data-theme (CSS custom
 *     property inheritance requires no JS — verified here via computed style).
 *
 *  4. Offline guard: the present route must not make any external network
 *     requests (spec principles-and-invariants / P9-2 invariant).
 *
 * CANNOT RUN WITHOUT THE BUILT BINARY:
 * =====================================
 * This is an e2e spec; it requires the `decks` binary + a running server.
 * Run it with:
 *   npm run test:e2e
 * or in Docker:
 *   npm run test:e2e:docker
 *
 * The spec CANNOT be executed with `npx vitest run` — Playwright and vitest
 * are separate harnesses (see playwright.config.ts).
 *
 * TYPE-CHECK WITHOUT RUNNING:
 * ============================
 *   cd web && npx tsc -p e2e/tsconfig.json
 */

import { test, expect } from '@playwright/test';

import { appendSlides, createDeck, getDeckHtml, putDeckHtml } from './fixtures.ts';

/** This spec's private deck. Never share a deck between spec files. */
const DECK = 'e2e-per-slide-theme';

// Unique data-eid values for the two slides we inject so we can target them
// precisely (avoids collisions with any prior injection by other specs).
const THEMED_EID  = 'e2e-themed-slide-p10';
const PLAIN_EID   = 'e2e-plain-slide-p10';

// Theme name and the expected --r-main-color it declares.
// solarized-dark: --r-main-color: #839496 (verified against the bundled CSS).
const THEME_NAME  = 'solarized-dark';
const THEME_COLOR = '#839496';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the URL points to an external (non-local) host. */
function isExternal(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return false;
  }
}

// ── Setup: scaffold this spec's own deck, then inject themed + plain slides ───

/**
 * This spec scaffolds and owns its own deck (see fixtures.ts — specs never
 * share a deck), then injects two slides after the existing slide(s):
 *   - A themed horizontal slide (data-theme="solarized-dark").
 *   - A plain slide with no theme (inherits deck default).
 * A vertical stack is also added under the themed slide to exercise the
 * vertical cascade: child sections must inherit --r-main-color.
 *
 * We use stable data-eid values so re-runs idempotently skip re-injection.
 */
test.beforeAll(async () => {
  await createDeck(DECK);
  let html = await getDeckHtml(DECK);

  // Idempotent: skip if already injected.
  if (html.includes(`data-eid="${THEMED_EID}"`)) return;

  // Build a themed horizontal slide that also has a vertical child.
  // The vertical child has NO data-theme so it inherits from the stack (CSS var
  // inheritance).  data-background-color on the stack is propagated to the child
  // by decks-layout-init.js (P10-7).
  const themedSlide =
    `<section data-eid="${THEMED_EID}" data-theme="${THEME_NAME}" ` +
    `data-background-color="#002b36">` +
    `<h2>Themed slide</h2>` +
    `<p data-eid="${THEMED_EID}-text">This slide uses ${THEME_NAME}.</p>` +
    // Vertical child — inherits --r-main-color via CSS, background via JS propagation.
    `<section data-eid="${THEMED_EID}-vertical"><p>Vertical child</p></section>` +
    `</section>`;

  const plainSlide =
    `<section data-eid="${PLAIN_EID}">` +
    `<h2>Plain slide</h2>` +
    `<p data-eid="${PLAIN_EID}-text">This slide inherits the deck theme.</p>` +
    `</section>`;

  // Append after the last existing </section> in the .slides block.
  html = appendSlides(html, `${themedSlide}\n${plainSlide}`);

  await putDeckHtml(DECK, html);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Per-slide theme fidelity — present route (P10-7 + P10-8)', () => {
  /**
   * P10-8: Assert that the themed slide shows a different --r-main-color than
   * the plain slide when viewed via the PRESENT route.
   *
   * The present route (/present/{name}/) serves deck.html directly from the
   * deck directory via os.DirFS.  deck.html links:
   *   assets/vendor/decks-slide-themes.css    ← generated at scaffold time
   * That CSS contains `.reveal section[data-theme="solarized-dark"] { --r-*: … }`.
   * The scoped --r-main-color is then consumed by reveal.js typography rules
   * (color: var(--r-main-color)), so the computed color differs between slides.
   *
   * PDF export uses the same present URL with ?print-pdf, so this assertion
   * transitively proves PDF fidelity.
   */
  test('themed slide has different --r-main-color than plain slide (present route)', async ({ page }) => {
    // Navigate to the present route (not the editor — this proves P10-8 directly).
    await page.goto(`/present/${DECK}/`);

    // Wait for reveal.js to bootstrap.
    await page.locator('.reveal').waitFor({ timeout: 10_000 });
    await page.locator('.reveal.ready, .reveal').waitFor({ timeout: 8_000 });

    // Read --r-main-color from the themed section.
    // page.evaluate runs in the browser context; access DOM globals via globalThis
    // because the e2e tsconfig omits "dom" from lib (Node-only type environment).
    const themedColor = await page.evaluate((eid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const doc = (globalThis as any).document as { querySelector(s: string): any };
      const gcs = (globalThis as any).getComputedStyle as (el: any) => any;
      const el = doc.querySelector(`section[data-eid="${eid}"]`);
      if (!el) return null;
      return (gcs(el).getPropertyValue('--r-main-color') as string).trim();
    }, THEMED_EID);

    // Read --r-main-color from the plain section.
    const plainColor = await page.evaluate((eid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const doc = (globalThis as any).document as { querySelector(s: string): any };
      const gcs = (globalThis as any).getComputedStyle as (el: any) => any;
      const el = doc.querySelector(`section[data-eid="${eid}"]`);
      if (!el) return null;
      return (gcs(el).getPropertyValue('--r-main-color') as string).trim();
    }, PLAIN_EID);

    // Both sections must exist in the DOM.
    expect(themedColor, 'themed slide section must exist in DOM').not.toBeNull();
    expect(plainColor,  'plain slide section must exist in DOM').not.toBeNull();

    // The themed slide must carry solarized-dark's --r-main-color.
    expect(
      themedColor,
      `section[data-theme="${THEME_NAME}"] must have --r-main-color ${THEME_COLOR} ` +
      `(from decks-slide-themes.css); got "${themedColor}"`,
    ).toBe(THEME_COLOR);

    // The themed and plain slides must differ — this is the core assertion.
    expect(
      themedColor,
      `Themed slide (--r-main-color: ${themedColor}) must differ from plain slide (${plainColor}) — ` +
      `decks-slide-themes.css scoping is not working`,
    ).not.toBe(plainColor);
  });

  /**
   * P18-1 (per-slide theme colours): the themed slide's PARAGRAPH text must have
   * a different computed `color` than the plain slide's — not just a different
   * --r-main-color var. This is the precise regression the Phase 18 fix targets:
   * reveal sets `color: var(--r-main-color)` on the `.reveal` ANCESTOR, and
   * `color` inherits as a computed value, so merely rebinding the var on a
   * descendant section did NOT recompute body text. The generated CSS now
   * re-asserts `color: var(--r-main-color)` ON section[data-theme], so the body
   * paragraph actually restyles.
   */
  test('themed slide paragraph has different computed color than plain (P18-1)', async ({ page }) => {
    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });

    const readColor = (eid: string) =>
      page.evaluate((id: string) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const doc = (globalThis as any).document as { querySelector(s: string): any };
        const gcs = (globalThis as any).getComputedStyle as (el: any) => any;
        const el = doc.querySelector(`p[data-eid="${id}"]`);
        if (!el) return null;
        return (gcs(el).color as string).trim();
      }, eid);

    const themedP = await readColor(`${THEMED_EID}-text`);
    const plainP = await readColor(`${PLAIN_EID}-text`);

    expect(themedP, 'themed paragraph must exist').not.toBeNull();
    expect(plainP, 'plain paragraph must exist').not.toBeNull();
    // The themed paragraph's body color must differ from the inherited default —
    // proves `color` is re-asserted at section scope, not only the var rebinding.
    expect(
      themedP,
      `Themed paragraph color (${themedP}) must differ from plain (${plainP}); ` +
      `P18-1 section-scoped \`color: var(--r-main-color)\` is not applying`,
    ).not.toBe(plainP);
  });

  /**
   * P10-7 (vertical cascade): A child section inside a themed vertical stack
   * must inherit the stack's --r-main-color via CSS custom property inheritance.
   * No JS is needed for the var cascade — this test verifies the CSS behavior.
   */
  test('vertical child inherits --r-main-color from themed stack (P10-7 CSS cascade)', async ({ page }) => {
    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });

    // The vertical child has no data-theme of its own — it inherits from the
    // parent section via CSS custom property inheritance.
    const childColor = await page.evaluate((eid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const doc = (globalThis as any).document as { querySelector(s: string): any };
      const gcs = (globalThis as any).getComputedStyle as (el: any) => any;
      const el = doc.querySelector(`section[data-eid="${eid}"]`);
      if (!el) return null;
      return (gcs(el).getPropertyValue('--r-main-color') as string).trim();
    }, `${THEMED_EID}-vertical`);

    expect(childColor, 'vertical child section must exist in DOM').not.toBeNull();

    // The child should carry the same --r-main-color as the parent stack
    // because CSS custom properties inherit through the DOM tree.
    expect(
      childColor,
      `Vertical child must inherit --r-main-color "${THEME_COLOR}" from themed stack ` +
      `(CSS custom property inheritance); got "${childColor}"`,
    ).toBe(THEME_COLOR);
  });

  /**
   * Offline guard: the present route must not fetch any external resources.
   * This is the P9-2 invariant; decks-slide-themes.css must be served from
   * the deck's vendored assets, not a CDN.
   */
  test('present route makes no external http(s) requests (offline guard)', async ({ page }) => {
    const externalRequests: string[] = [];

    // Listen BEFORE navigating so early requests are captured.
    page.on('request', (req) => {
      if (isExternal(req.url())) externalRequests.push(req.url());
    });

    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });

    // Let any lazy/deferred loads settle.
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {
      // networkidle can time out on SSE connections — that's fine.
    });

    expect(
      externalRequests,
      `Present route made ${externalRequests.length} external request(s):\n` +
        externalRequests.map((u) => `  • ${u}`).join('\n'),
    ).toHaveLength(0);
  });
});
