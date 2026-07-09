/**
 * e2e/phase17.spec.ts — Phase 17 everyday-authoring features (P17-21).
 *
 * WHAT IS TESTED (and WHY here, against the built binary + present route):
 * =======================================================================
 * Phase 17 added a broad set of authoring features. The unit/component suites
 * (vitest) already cover the pure model/serializer/command logic; this spec is
 * the END-TO-END proof that the features actually render in a real browser
 * against the real Go server, and — critically — that the offline-first and
 * byte-stability invariants still hold (spec principles-and-invariants).
 *
 *  1. Rich-text inline marks (Lane A/B): a leaf containing <strong>/<em>/<a>
 *     round-trips through the deck API and renders in the present route — the
 *     sanitizing inline writeback never strips allowlisted marks (P17-1..3,6,9).
 *  2. Chart block (Lane F): a <canvas data-chart data-chart-data='…'> is rendered
 *     by the vendored Chart.js plugin (the canvas gets a 2D drawing) on the
 *     present route, fully offline (P17-15).
 *  3. Slide numbers (Lane G): POST /api/decks/{name}/slide-number flips reveal's
 *     slideNumber and the present route shows the number element (P17-17).
 *  4. Footer (Lane G): a managed custom.css footer rule renders an overlay on
 *     slides and is suppressed on a data-footer-hidden slide (P17-18).
 *  5. Present-mode plugins (Lane H): the present route injects the chalkboard +
 *     laser plugin scripts and registers them, while the ON-DISK deck.html stays
 *     byte-identical (annotations are ephemeral — spec presenting-and-export) (P17-19).
 *  6. Offline guard: the present route makes zero external http(s) requests with
 *     all of the above present (spec principles-and-invariants / P9-2).
 *
 * CANNOT RUN WITHOUT THE BUILT BINARY (Playwright, not vitest):
 *   npm run test:e2e        (or npm run test:e2e:docker)
 * Type-check without running:
 *   cd web && npx tsc -p e2e/tsconfig.json
 */

import { test, expect } from '@playwright/test';

// Keep in sync with global-setup.ts SMOKE_DECK constant.
const SMOKE_DECK = 'smoke-deck';

// Stable eids so re-runs are idempotent (we only inject once).
const RICH_EID = 'e2e-rich-p17';
const CHART_EID = 'e2e-chart-p17';
const FOOTER_HIDDEN_EID = 'e2e-footerhidden-p17';

// ── Helpers (mirror per-slide-theme.spec.ts) ─────────────────────────────────

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

function isExternal(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return false;
  }
}

// A minimal, valid Chart.js JSON config (HTML-attribute-encoded by the browser
// when we inject via innerHTML; here we keep it as a plain string and rely on
// the server storing the bytes verbatim).
const CHART_JSON = JSON.stringify({
  type: 'bar',
  data: { labels: ['A', 'B'], datasets: [{ label: 'n', data: [3, 7] }] },
  options: { animation: false, responsive: false },
});

// ── Setup: inject Phase 17 content into the smoke deck once ───────────────────

test.beforeAll(async ({ baseURL }) => {
  const baseUrl = baseURL ?? 'http://localhost:19999';
  let html = await getDeckHtml(baseUrl, SMOKE_DECK);
  if (html.includes(`data-eid="${RICH_EID}"`)) return; // idempotent

  // Rich-text marks + an external link (navigation, not a resource load).
  const richSlide =
    `<section data-eid="${RICH_EID}">` +
    `<p data-eid="${RICH_EID}-p">Plain <strong>bold</strong> and <em>italic</em> and ` +
    `<a href="https://example.com" target="_blank" rel="noopener">a link</a>.</p>` +
    `</section>`;

  // Chart slide. data-chart-data holds the JSON config; quotes are escaped by
  // the server's serializer round-trip (the plugin JSON.parses the decoded value).
  const chartSlide =
    `<section data-eid="${CHART_EID}">` +
    `<canvas data-eid="${CHART_EID}-c" width="600" height="400" data-chart="bar" ` +
    `data-chart-data='${CHART_JSON.replace(/'/g, '&#39;')}'></canvas>` +
    `</section>`;

  // A slide that opts out of the footer overlay.
  const footerHiddenSlide =
    `<section data-eid="${FOOTER_HIDDEN_EID}" data-footer-hidden><p>no footer here</p></section>`;

  html = html.replace(
    /(<div class="slides">)/,
    `$1\n${richSlide}\n${chartSlide}\n${footerHiddenSlide}\n`,
  );
  await putDeckHtml(baseUrl, SMOKE_DECK, html);

  // Managed footer rule via custom.css (matches Lane G's managed block shape).
  const footerCss =
    `/* slides-builder:footer */\n` +
    `.reveal .slides section:not([data-footer-hidden])::after {\n` +
    `  content: "Confidential — e2e"; position: fixed; left: 0; right: 0; bottom: 0.6em;\n` +
    `  text-align: center; font-size: 0.4em; color: #888; opacity: 0.7;\n` +
    `  pointer-events: none; z-index: 30;\n` +
    `}\n` +
    `/* /slides-builder:footer */\n`;
  const cssRes = await fetch(`${baseUrl}/api/decks/${encodeURIComponent(SMOKE_DECK)}/custom.css`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/css' },
    body: footerCss,
  });
  if (!cssRes.ok) throw new Error(`PUT custom.css → ${cssRes.status}`);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Phase 17 — present route', () => {
  test('inline marks + link survive round-trip and render (P17-1..3,6,9)', async ({ page }) => {
    await page.goto(`/present/${SMOKE_DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });

    const marks = await page.evaluate((eid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const doc = (globalThis as any).document as { querySelector(s: string): any };
      const el = doc.querySelector(`p[data-eid="${eid}"]`);
      if (!el) return null;
      return {
        strong: !!el.querySelector('strong'),
        em: !!el.querySelector('em'),
        href: el.querySelector('a') ? el.querySelector('a').getAttribute('href') : null,
      };
    }, `${RICH_EID}-p`);

    expect(marks, 'rich-text paragraph must exist').not.toBeNull();
    expect(marks!.strong, '<strong> must survive').toBe(true);
    expect(marks!.em, '<em> must survive').toBe(true);
    expect(marks!.href, 'external <a href> navigation is allowed').toBe('https://example.com');
  });

  test('chart canvas is rendered by Chart.js, offline (P17-15)', async ({ page }) => {
    await page.goto(`/present/${SMOKE_DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });
    // Navigate so the chart slide becomes current (the plugin renders on init +
    // slidechanged). Use reveal's URL hash by index is brittle; instead assert
    // the plugin attached a Chart instance to the canvas after a short settle.
    const rendered = await page.evaluate(async (eid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const g = globalThis as any;
      const doc = g.document as { querySelector(s: string): any };
      // Give reveal + the chart plugin a moment to initialise.
      await new Promise((r) => g.setTimeout(r, 800));
      const c = doc.querySelector(`canvas[data-eid="${eid}"]`);
      if (!c) return { exists: false, hasChart: false };
      return { exists: true, hasChart: !!c._sbChart };
    }, `${CHART_EID}-c`);

    expect(rendered.exists, 'chart canvas must exist in the DOM').toBe(true);
    expect(rendered.hasChart, 'Chart.js must have rendered into the canvas').toBe(true);
  });

  test('present-mode plugins injected; on-disk deck.html unchanged (P17-19)', async ({ baseURL }) => {
    const baseUrl = baseURL ?? 'http://localhost:19999';
    const before = await getDeckHtml(baseUrl, SMOKE_DECK);

    const presentRes = await fetch(`${baseUrl}/present/${encodeURIComponent(SMOKE_DECK)}/`);
    const presentHtml = await presentRes.text();
    expect(presentHtml).toContain('assets/vendor/chalkboard/plugin.js');
    expect(presentHtml).toContain('assets/vendor/laser/plugin.js');
    expect(presentHtml).toContain('registerPlugin');

    // The augmentation is in-memory only: the file on disk is byte-identical.
    const after = await getDeckHtml(baseUrl, SMOKE_DECK);
    expect(after, 'present route must NOT mutate deck.html on disk').toBe(before);
    // And it must not have injected the present-only plugins into the file.
    expect(after).not.toContain('chalkboard/plugin.js');
  });

  test('slide number toggles on via the API (P17-17)', async ({ page, baseURL }) => {
    const baseUrl = baseURL ?? 'http://localhost:19999';
    const res = await fetch(`${baseUrl}/api/decks/${encodeURIComponent(SMOKE_DECK)}/slide-number`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, format: 'c/t' }),
    });
    expect(res.status).toBe(204);

    await page.goto(`/present/${SMOKE_DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });
    // reveal renders the number into .slide-number when slideNumber is set.
    await expect(page.locator('.reveal .slide-number')).toBeVisible({ timeout: 8_000 });
  });

  test('footer overlay renders and is suppressed on a hidden slide (P17-18)', async ({ page }) => {
    await page.goto(`/present/${SMOKE_DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });

    // Read the ::after content of a normal section vs the footer-hidden one.
    const result = await page.evaluate((hiddenEid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const g = globalThis as any;
      const doc = g.document as { querySelector(s: string): any };
      const gcs = g.getComputedStyle as (el: any, pseudo: string) => any;
      const first = doc.querySelector('.reveal .slides section:not([data-footer-hidden])');
      const hidden = doc.querySelector(`section[data-eid="${hiddenEid}"]`);
      const norm = first ? gcs(first, '::after').getPropertyValue('content') : '';
      const hid = hidden ? gcs(hidden, '::after').getPropertyValue('content') : '';
      return { norm, hid };
    }, FOOTER_HIDDEN_EID);

    expect(result.norm).toContain('Confidential');
    // The hidden slide's ::after has no footer content (none/normal/empty).
    expect(result.hid).not.toContain('Confidential');
  });

  test('present route makes no external http(s) requests (offline guard)', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (req) => {
      if (isExternal(req.url())) external.push(req.url());
    });
    await page.goto(`/present/${SMOKE_DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    expect(external, `external requests: ${external.join(', ')}`).toEqual([]);
  });
});
