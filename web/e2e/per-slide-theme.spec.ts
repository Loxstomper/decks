/**
 * e2e/per-slide-theme.spec.ts — Per-slide theme fidelity (P10-7 + P10-8).
 *
 * WHAT IS TESTED:
 * ===============
 *  1. A slide with `data-theme="solarized-dark"` shows a different computed
 *     --r-main-color and text color than an adjacent unthemed slide.  This
 *     exercises P10-1's generated slides-slide-themes.css, which scopes
 *     --r-* custom properties to section[data-theme], and CSS inheritance,
 *     which carries those vars into the slide's content nodes.
 *
 *  2. Present/PDF fidelity (P10-8): the assertion is made against the PRESENT
 *     route (/present/{name}/) — not the editor iframe — because that is the
 *     route served for both live presentation and PDF export (?print-pdf).
 *     The present route delegates to os.DirFS(deckDir) and serves deck.html
 *     plus all assets under that directory, including
 *     assets/vendor/slides-slide-themes.css which was written at scaffold time.
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
 * This is an e2e spec; it requires the `slides` binary + a running server.
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

// Keep in sync with global-setup.ts SMOKE_DECK constant.
const SMOKE_DECK = 'smoke-deck';

// Unique data-eid values for the two slides we inject so we can target them
// precisely (avoids collisions with any prior injection by other specs).
const THEMED_EID  = 'e2e-themed-slide-p10';
const PLAIN_EID   = 'e2e-plain-slide-p10';

// Theme name and the expected --r-main-color it declares.
// solarized-dark: --r-main-color: #839496 (verified against the bundled CSS).
const THEME_NAME  = 'solarized-dark';
const THEME_COLOR = '#839496';

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

// ── Setup: inject themed + plain slides into the smoke deck ───────────────────

/**
 * Inject two slides after the first existing slide:
 *   - A themed horizontal slide (data-theme="solarized-dark").
 *   - A plain slide with no theme (inherits deck default).
 * A vertical stack is also added under the themed slide to exercise the
 * vertical cascade: child sections must inherit --r-main-color.
 *
 * We use stable data-eid values so re-runs idempotently skip re-injection.
 */
test.beforeAll(async ({ baseURL }) => {
  const baseUrl = baseURL ?? 'http://localhost:19999';
  let html = await getDeckHtml(baseUrl, SMOKE_DECK);

  // Idempotent: skip if already injected.
  if (html.includes(`data-eid="${THEMED_EID}"`)) return;

  // Build a themed horizontal slide that also has a vertical child.
  // The vertical child has NO data-theme so it inherits from the stack (CSS var
  // inheritance).  data-background-color on the stack is propagated to the child
  // by slides-layout-init.js (P10-7).
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
  // We splice before </div> that closes .slides to keep the HTML valid.
  html = html.replace(
    /(<\/div>\s*<\/div>[\s\S]*?<\/body>)/,
    `${themedSlide}\n${plainSlide}\n$1`,
  );

  await putDeckHtml(baseUrl, SMOKE_DECK, html);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Per-slide theme fidelity — present route (P10-7 + P10-8)', () => {
  /**
   * P10-8: Assert that the themed slide shows a different --r-main-color than
   * the plain slide when viewed via the PRESENT route.
   *
   * The present route (/present/{name}/) serves deck.html directly from the
   * deck directory via os.DirFS.  deck.html links:
   *   assets/vendor/slides-slide-themes.css    ← generated at scaffold time
   * That CSS contains `.reveal section[data-theme="solarized-dark"] { --r-*: … }`.
   * The scoped --r-main-color is then consumed by reveal.js typography rules
   * (color: var(--r-main-color)), so the computed color differs between slides.
   *
   * PDF export uses the same present URL with ?print-pdf, so this assertion
   * transitively proves PDF fidelity.
   */
  test('themed slide has different --r-main-color than plain slide (present route)', async ({ page }) => {
    // Navigate to the present route (not the editor — this proves P10-8 directly).
    await page.goto(`/present/${SMOKE_DECK}/`);

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
      `(from slides-slide-themes.css); got "${themedColor}"`,
    ).toBe(THEME_COLOR);

    // The themed and plain slides must differ — this is the core assertion.
    expect(
      themedColor,
      `Themed slide (--r-main-color: ${themedColor}) must differ from plain slide (${plainColor}) — ` +
      `slides-slide-themes.css scoping is not working`,
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
    await page.goto(`/present/${SMOKE_DECK}/`);
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
    await page.goto(`/present/${SMOKE_DECK}/`);
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
   * This is the P9-2 invariant; slides-slide-themes.css must be served from
   * the deck's vendored assets, not a CDN.
   */
  test('present route makes no external http(s) requests (offline guard)', async ({ page }) => {
    const externalRequests: string[] = [];

    // Listen BEFORE navigating so early requests are captured.
    page.on('request', (req) => {
      if (isExternal(req.url())) externalRequests.push(req.url());
    });

    await page.goto(`/present/${SMOKE_DECK}/`);
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
