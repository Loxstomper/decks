/**
 * e2e/qr.spec.ts — QR code block (P19-5).
 *
 * WHAT IS TESTED (against the built binary + present route):
 *  1. A <div data-qr> is rendered into a scannable SVG by the vendored QR plugin
 *     on the present route — fully offline (P19-1/2). We assert the plugin
 *     injected an <svg> with the expected module structure (finder-pattern rects)
 *     and honoured the colours.
 *  2. The on-disk deck.html keeps the div EMPTY (byte-stable data-bound model):
 *     the SVG is a runtime artefact, never persisted.
 *  3. Offline guard: the present route makes zero external http(s) requests with
 *     the QR present (spec principles-and-invariants / P9-2).
 *
 * The script-free navigator thumbnail painting a placeholder is a unit-tested
 * concern (thumbnail.ts substituteQrPlaceholders) — not exercised here.
 *
 * SETUP: this spec scaffolds and owns its own deck (see fixtures.ts — specs
 * never share a deck), then injects a QR slide via the PUT API.
 *
 * CANNOT RUN WITHOUT THE BUILT BINARY (Playwright, not vitest):
 *   npm run test:e2e        (or npm run test:e2e:docker)
 * Type-check without running:
 *   cd web && npx tsc -p e2e/tsconfig.json
 */

import { test, expect } from '@playwright/test';

import { createDeck, getDeckHtml, prependSlides, putDeckHtml } from './fixtures.ts';

/** This spec's private deck. Never share a deck between spec files. */
const DECK = 'e2e-qr';

const QR_EID = 'e2e-qr-p19';
const QR_PAYLOAD = 'https://example.com/qr-e2e';

function isExternal(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return false;
  }
}

// ── Setup: scaffold this spec's own deck and inject a QR slide ────────────────

test.beforeAll(async () => {
  await createDeck(DECK);
  let html = await getDeckHtml(DECK);
  if (html.includes(`data-eid="${QR_EID}"`)) return; // idempotent

  const qrSlide =
    `<section data-eid="${QR_EID}">` +
    `<div data-eid="${QR_EID}-q" data-qr="${QR_PAYLOAD}" data-qr-ec="M" ` +
    `data-qr-fg="#000000" data-qr-bg="#ffffff" data-qr-quiet="4" ` +
    `aria-label="QR code: ${QR_PAYLOAD}" style="width: 280px; height: 280px"></div>` +
    `</section>`;

  html = prependSlides(html, qrSlide);
  await putDeckHtml(DECK, html);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Phase 19 — QR code block', () => {
  test('QR div is rendered to an SVG by the plugin, offline (P19-1/2)', async ({ page }) => {
    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });

    const result = await page.evaluate(async (eid: string) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const g = globalThis as any;
      const doc = g.document as { querySelector(s: string): any };
      // Give reveal + the QR plugin a moment to initialise.
      await new Promise((r) => g.setTimeout(r, 800));
      const div = doc.querySelector(`div[data-qr][data-eid="${eid}"]`);
      if (!div) return { exists: false } as any;
      const svg = div.querySelector('svg');
      return {
        exists: true,
        hasSvg: !!svg,
        // The generated SVG carries a background rect + a group of module rects.
        rectCount: svg ? svg.querySelectorAll('rect').length : 0,
        ariaLabel: svg ? svg.getAttribute('aria-label') : null,
        viewBox: svg ? svg.getAttribute('viewBox') : null,
      };
    }, `${QR_EID}-q`);

    expect(result.exists, 'QR div must exist in the DOM').toBe(true);
    expect(result.hasSvg, 'plugin must render an <svg> into the div').toBe(true);
    // A real QR (version ≥1, 21×21) merges into many rects — well above a handful.
    expect(result.rectCount, 'SVG must contain QR module rects').toBeGreaterThan(10);
    expect(result.ariaLabel).toContain('example.com/qr-e2e');
    expect(result.viewBox, 'viewBox includes quiet zone (modules + 8)').toMatch(/^0 0 \d+ \d+$/);
  });

  test('on-disk QR div stays empty — the SVG is a runtime artefact (byte-stable)', async () => {
    const html = await getDeckHtml(DECK);
    expect(html).toContain(`data-qr="${QR_PAYLOAD}"`);
    // The QR div itself must round-trip EMPTY on disk — the runtime SVG is never
    // persisted (data-bound, byte-stable). Match just this element's inner HTML.
    const m = html.match(new RegExp(`<div[^>]*data-eid="${QR_EID}-q"[^>]*>([\\s\\S]*?)</div>`));
    expect(m, 'QR div must be present on disk').not.toBeNull();
    expect(m![1].trim(), 'QR div must be empty on disk (SVG is runtime-only)').toBe('');
  });

  test('present route makes no external http(s) requests (offline guard)', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (req) => {
      if (isExternal(req.url())) external.push(req.url());
    });
    await page.goto(`/present/${DECK}/`);
    await page.locator('.reveal').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    expect(external, `external requests: ${external.join(', ')}`).toEqual([]);
  });
});
