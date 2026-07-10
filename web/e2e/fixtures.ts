/**
 * e2e/fixtures.ts — deck fixtures shared by every Playwright spec.
 *
 * WHY THIS EXISTS
 * ===============
 * Two harness bugs made a third of the suite order-dependent. Both are fixed
 * here, and both are worth understanding before touching a spec.
 *
 * 1. EVERY SPEC OWNS ITS DECK.
 *    The suite used to share the single scaffolded `smoke-deck`, and most specs
 *    injected fixture HTML into it. With `workers: 1` the files run one after
 *    another against one live server, so spec N observed the accumulated writes
 *    of specs 1..N-1. `slide-background` and `slide-layouts` passed alone and
 *    failed in the full run purely because `qr` had spliced a slide in ahead of
 *    them. Sharing mutable state across spec files is the bug; `createDeck()`
 *    gives each file a private deck so the specs are order-independent and each
 *    one is runnable in isolation (`playwright test e2e/<file>.spec.ts`).
 *
 * 2. THE EDITOR OPENS `decks[0]`, NOT "your" DECK.
 *    `App.onMount` does `await deckStore.load(decks[0])` — the first entry of
 *    `GET /api/decks`, which the Go side returns sorted by folder name. So the
 *    moment `create-deck.spec.ts` creates `e2e-created-deck` (which sorts before
 *    `smoke-deck`), a bare `page.goto('/')` in a later spec silently opens the
 *    WRONG deck, and assertions against the canvas iframe fail with nothing in
 *    the error to suggest why. `openDeckInEditor()` navigates and then clicks the
 *    deck's own button, waiting until the iframe's `src` actually points at that
 *    deck — so a spec can never assert against a canvas showing someone else's
 *    slides, no matter what the deck list looks like.
 *
 * SPLICING FIXTURE HTML
 * =====================
 * The inject helpers below replace four hand-rolled `String.replace(/…/)` calls
 * that had been copy-pasted between specs. A non-matching `String.replace` is a
 * SILENT no-op: it returns the input unchanged, the spec PUTs the deck back
 * untouched, and the failure surfaces later as a baffling "element not found".
 * These helpers throw instead, so a broken anchor names itself.
 */

import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

import { BASE_URL, STATE_FILE } from './constants.ts';

// ── Workspace ────────────────────────────────────────────────────────────────

/** Absolute path of the temp workspace global-setup created (holds `decks/`). */
export function workspaceDir(): string {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { tmpDir: string };
  return state.tmpDir;
}

/** Absolute path of a deck's `assets/` directory inside the temp workspace. */
export function deckAssetsDir(deck: string): string {
  return `${workspaceDir()}/decks/${deck}/assets`;
}

// ── Deck HTTP API ────────────────────────────────────────────────────────────

/**
 * Scaffold `deck` via `POST /api/decks/{name}` (the same path the "+ Deck"
 * button drives — `deck.New` on the Go side, so the deck gets reveal.js vendored
 * offline just like `decks new`).
 *
 * A 409 means the deck already exists, which is what a re-run against a
 * persisted workspace looks like; treat it as success so setup stays idempotent.
 */
export async function createDeck(deck: string, baseUrl: string = BASE_URL): Promise<void> {
  const res = await fetch(`${baseUrl}/api/decks/${encodeURIComponent(deck)}`, { method: 'POST' });
  if (!res.ok && res.status !== 409) {
    throw new Error(`POST /api/decks/${deck} → ${res.status} ${await res.text()}`);
  }
}

/** Fetch the current `deck.html` source. */
export async function getDeckHtml(deck: string, baseUrl: string = BASE_URL): Promise<string> {
  const res = await fetch(`${baseUrl}/api/decks/${encodeURIComponent(deck)}`);
  if (!res.ok) throw new Error(`GET /api/decks/${deck} → ${res.status}`);
  return res.text();
}

/** Write `deck.html`. The deck must already exist — PUT never creates one. */
export async function putDeckHtml(
  deck: string,
  html: string,
  baseUrl: string = BASE_URL,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/decks/${encodeURIComponent(deck)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/html' },
    body: html,
  });
  if (!res.ok) throw new Error(`PUT /api/decks/${deck} → ${res.status}`);
}

// ── Fixture HTML injection ───────────────────────────────────────────────────

/** Index just past the `.slides` container's opening tag. Throws when absent. */
function slidesOpenEnd(html: string): number {
  const open = '<div class="slides">';
  const i = html.indexOf(open);
  if (i === -1) {
    throw new Error('inject: could not find `<div class="slides">` — is this a scaffolded deck?');
  }
  return i + open.length;
}

/**
 * Append `fragment` as the LAST slide(s), after the final `</section>`.
 *
 * Anchored on the last `</section>` rather than on the `</div></div>` that closes
 * `.slides` + `.reveal`: any fixture slide containing nested `<div>`s introduces
 * an earlier `</div></div>`, and a regex looking for the first one would splice
 * the new slides *inside* a slide, where reveal.js never treats them as slides.
 * That is precisely the bug that made `qr.spec.ts` break `slide-background`.
 */
export function appendSlides(html: string, fragment: string): string {
  const start = slidesOpenEnd(html);
  const close = html.lastIndexOf('</section>');
  if (close < start) {
    throw new Error('inject: no `</section>` inside `.slides` to append after');
  }
  const at = close + '</section>'.length;
  return `${html.slice(0, at)}\n${fragment}\n${html.slice(at)}`;
}

/** Insert `fragment` as the FIRST slide(s), immediately inside `.slides`. */
export function prependSlides(html: string, fragment: string): string {
  const at = slidesOpenEnd(html);
  return `${html.slice(0, at)}\n${fragment}\n${html.slice(at)}`;
}

/** Append `fragment` inside the FIRST slide, before its `</section>`. */
export function appendToFirstSlide(html: string, fragment: string): string {
  const start = slidesOpenEnd(html);
  const close = html.indexOf('</section>', start);
  if (close === -1) {
    throw new Error('inject: the deck has no first `<section>` to append into');
  }
  return `${html.slice(0, close)}${fragment}${html.slice(close)}`;
}

// ── Editor navigation ────────────────────────────────────────────────────────

/** The canvas iframe. Hidden until `RevealFrame.handleLoad()` clears `isLoading`. */
const CANVAS = 'iframe.reveal-frame-iframe';

/**
 * Open the editor at `deck` and wait until its canvas is genuinely rendered.
 *
 * Clicks the deck's button in the sidebar rather than trusting `goto('/')` to
 * land on the right deck (see the header note on `decks[0]`), then waits for the
 * iframe `src` to name this deck before waiting on its content — otherwise we
 * would race the previous deck's still-attached `<section>`s.
 */
export async function openDeckInEditor(page: Page, deck: string): Promise<void> {
  await page.goto('/');

  const deckButton = page.getByRole('button', { name: deck, exact: true });
  await expect(deckButton).toBeVisible({ timeout: 12_000 });
  await deckButton.click();

  // `src` is `/decks/{name}/deck.html` (+ a cache-busting nonce on reload).
  await expect(page.locator(CANVAS)).toHaveAttribute(
    'src',
    new RegExp(`/decks/${escapeRegExp(encodeURIComponent(deck))}/deck\\.html`),
    { timeout: 12_000 },
  );
  await expect(page.locator(CANVAS)).toBeVisible({ timeout: 12_000 });
  await expect(
    page.frameLocator(CANVAS).locator('.reveal .slides section').first(),
  ).toBeAttached({ timeout: 10_000 });
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Navigator thumbnails ─────────────────────────────────────────────────────

/**
 * Scroll every navigator slide row into view and wait until all of their
 * thumbnails have rendered.
 *
 * `SlideThumbnail` gates `srcdoc` behind an IntersectionObserver — an offscreen
 * thumbnail is never built, because each one links ~7 of the deck's stylesheets
 * and an opaque-origin srcdoc iframe refetches all of them. So any test that reads
 * `iframe.thumb-frame`'s `srcdoc` must first bring the row on-screen, or it reads
 * `undefined` for every row below the fold. This bites intermittently: the number
 * of decks in the sidebar changes how far down the filmstrip starts, so a spec can
 * pass alone and fail in the full suite. `loaded` latches once true, so scrolling
 * through the whole list leaves them all rendered.
 */
export async function loadAllThumbnails(page: Page): Promise<void> {
  const rows = page.locator('.slide-row[role="option"]');
  await expect(rows.first()).toBeAttached({ timeout: 12_000 });

  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    await rows.nth(i).scrollIntoViewIfNeeded();
  }

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          /* eslint-disable @typescript-eslint/no-explicit-any */
          const doc = (globalThis as any).document as any;
          const all: any[] = Array.from(doc.querySelectorAll('.slide-row[role="option"]'));
          return all.every(
            (r: any) => (((r.querySelector('iframe.thumb-frame') as any)?.srcdoc ?? '') as string) !== '',
          );
        }),
      { timeout: 15_000, message: 'not every navigator row rendered its thumbnail srcdoc' },
    )
    .toBe(true);
}

/** The `srcdoc` of every navigator thumbnail, in row order. */
export async function thumbnailSrcdocs(page: Page): Promise<string[]> {
  await loadAllThumbnails(page);
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const doc = (globalThis as any).document as any;
    return Array.from(doc.querySelectorAll('.slide-row[role="option"]')).map(
      (r: any) => (((r.querySelector('iframe.thumb-frame') as any)?.srcdoc ?? '') as string),
    );
  });
}

// ── Assertions helpers ───────────────────────────────────────────────────────

/**
 * A context-menu item, matched by ACCESSIBLE NAME.
 *
 * Do NOT reach for `page.locator('.cm-item', { hasText: /^Delete$/ })`. A regex
 * `hasText` is tested against the element's raw text, and a `.cm-item`'s text is
 * `"Delete "` — ContextMenu.svelte leaves a space between `<span class="cm-label">`
 * and the `{#if item.submenu}` chevron block. The anchored `$` therefore never
 * matches, which is why three context-menu specs had never once passed even though
 * the menu itself works. Accessible-name matching trims, and `exact: true` still
 * distinguishes "Delete" from "Delete slide".
 */
export function menuItem(page: Page, label: string) {
  return page.getByRole('menuitem', { name: label, exact: true });
}
