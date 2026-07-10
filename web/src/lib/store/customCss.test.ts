/**
 * customCss.test.ts — Tests for the setCssVar utility (P6-12 idempotent CSS var).
 *
 * We test the pure function setCssVar exported from customCss.svelte.ts
 * without spinning up the full Svelte store (which requires a browser
 * environment and a live server). All the reactive store logic is covered
 * by the Go server tests and the integration tests.
 */

import { describe, it, expect } from 'vitest';
import {
  setCssVar,
  setFooterBlock,
  clearFooterBlock,
  buildFooterBlock,
  parseFooterBlock,
} from './customCss.svelte.ts';

describe('setCssVar', () => {
  // ── Creates :root block when absent ──────────────────────────────────────

  it('prepends :root block when CSS is empty', () => {
    const result = setCssVar('', '--r-main-color', '#fff');
    expect(result).toContain(':root {');
    expect(result).toContain('--r-main-color: #fff;');
    // :root block should be at the start.
    expect(result.trimStart().startsWith(':root')).toBe(true);
  });

  it('prepends :root block when no :root block exists', () => {
    const css = '/* existing comment */\n.reveal { color: red; }\n';
    const result = setCssVar(css, '--r-main-color', '#fff');
    expect(result).toContain(':root {');
    expect(result).toContain('--r-main-color: #fff;');
    expect(result).toContain('/* existing comment */');
  });

  // ── Appends variable inside existing :root block ──────────────────────────

  it('appends variable to empty :root block', () => {
    const css = ':root {\n}\n';
    const result = setCssVar(css, '--r-main-color', '#abc');
    expect(result).toContain('--r-main-color: #abc;');
    // Must still have exactly one :root block.
    expect((result.match(/:root\s*\{/g) ?? []).length).toBe(1);
  });

  it('appends variable to :root block with existing vars', () => {
    const css = ':root {\n  --r-background-color: #191919;\n}\n';
    const result = setCssVar(css, '--r-main-color', '#fff');
    expect(result).toContain('--r-background-color: #191919;');
    expect(result).toContain('--r-main-color: #fff;');
    // Still one :root block.
    expect((result.match(/:root\s*\{/g) ?? []).length).toBe(1);
  });

  // ── Replaces existing variable in-place ───────────────────────────────────

  it('replaces existing variable value', () => {
    const css = ':root {\n  --r-main-color: #fff;\n}\n';
    const result = setCssVar(css, '--r-main-color', '#ff0000');
    expect(result).toContain('--r-main-color: #ff0000;');
    // Old value gone.
    expect(result).not.toContain('--r-main-color: #fff;');
  });

  it('replaces variable with surrounding whitespace', () => {
    const css = ':root {\n  --r-main-color :  #aabbcc  ;\n}\n';
    const result = setCssVar(css, '--r-main-color', 'red');
    expect(result).toContain('--r-main-color: red;');
    expect(result).not.toContain('#aabbcc');
  });

  // ── Idempotent: applying same value twice produces same result ────────────

  it('is idempotent (applying same value twice = same output)', () => {
    const css = ':root {\n  --r-main-color: #fff;\n}\n';
    const once = setCssVar(css, '--r-main-color', '#abc');
    const twice = setCssVar(once, '--r-main-color', '#abc');
    expect(once).toBe(twice);
  });

  // ── Does not duplicate the :root block ───────────────────────────────────

  it('never creates a second :root block', () => {
    let css = ':root {\n  --r-background-color: #111;\n}\n/* user styles */\n';
    css = setCssVar(css, '--r-main-color', 'white');
    css = setCssVar(css, '--r-heading-color', 'white');
    css = setCssVar(css, '--r-link-color', '#4a9eff');
    const rootBlockCount = (css.match(/:root\s*\{/g) ?? []).length;
    expect(rootBlockCount).toBe(1);
  });

  // ── Normalises varName (auto-prepend --) ──────────────────────────────────

  it('accepts variable names without -- prefix and normalises', () => {
    const result = setCssVar('', 'r-main-color', 'blue');
    expect(result).toContain('--r-main-color: blue;');
  });

  // ── Preserves user CSS below the :root block ──────────────────────────────

  it('preserves user CSS below the :root block', () => {
    const css = ':root {\n  --r-main-color: #fff;\n}\n\n.reveal h1 { font-size: 2em; }\n';
    const result = setCssVar(css, '--r-main-color', 'red');
    expect(result).toContain('.reveal h1 { font-size: 2em; }');
  });

  // ── Works with multi-line :root blocks ────────────────────────────────────

  it('handles multi-line :root block', () => {
    const css = `:root {
  --r-background-color: #191919;
  --r-main-font: "Helvetica Neue", sans-serif;
  --r-main-color: #fff;
  --r-heading-color: #fff;
}
`;
    const result = setCssVar(css, '--r-main-color', '#e0e0e0');
    expect(result).toContain('--r-main-color: #e0e0e0;');
    expect(result).not.toContain('--r-main-color: #fff;');
    // Other vars untouched.
    expect(result).toContain('--r-background-color: #191919;');
    expect(result).toContain('--r-heading-color: #fff;');
  });

  // ── @import lines above :root block are preserved ────────────────────────

  it('preserves @import lines above the :root block', () => {
    const css = `@import url("assets/fonts/inter/font-face.css");

:root {
  --r-main-color: #fff;
}
`;
    const result = setCssVar(css, '--r-main-color', 'red');
    expect(result).toContain('@import url("assets/fonts/inter/font-face.css");');
    expect(result).toContain('--r-main-color: red;');
    expect(result).not.toContain('--r-main-color: #fff;');
  });
});

// ── P17-18: managed footer block ───────────────────────────────────────────

const USER_CSS = `:root {
  --r-main-color: #fff;
}

.reveal h1 { color: hotpink; }
`;

describe('setFooterBlock / clearFooterBlock (P17-18)', () => {
  it('inserts a managed footer block keyed off :not([data-footer-hidden])', () => {
    const out = setFooterBlock(USER_CSS, 'Acme Inc — Confidential');
    expect(out).toContain('/* decks:footer */');
    expect(out).toContain('/* /decks:footer */');
    expect(out).toContain('.reveal .slides section:not([data-footer-hidden])::after');
    expect(out).toContain('content: "Acme Inc — Confidential";');
    // User CSS + :root block preserved verbatim.
    expect(out).toContain('--r-main-color: #fff;');
    expect(out).toContain('.reveal h1 { color: hotpink; }');
  });

  it('is idempotent — re-setting the same footer yields byte-identical CSS', () => {
    const once = setFooterBlock(USER_CSS, 'Footer');
    const twice = setFooterBlock(once, 'Footer');
    expect(twice).toBe(once);
  });

  it('replaces (not duplicates) an existing footer block on text change', () => {
    const a = setFooterBlock(USER_CSS, 'Old');
    const b = setFooterBlock(a, 'New');
    expect(b).toContain('content: "New";');
    expect(b).not.toContain('content: "Old";');
    expect((b.match(/decks:footer \*\//g) ?? []).length).toBe(2); // open + close once
  });

  it('clears the footer block and restores the user CSS', () => {
    const withFooter = setFooterBlock(USER_CSS, 'Bye');
    const cleared = clearFooterBlock(withFooter);
    expect(cleared).not.toContain('decks:footer');
    expect(cleared).toContain('--r-main-color: #fff;');
    expect(cleared).toContain('.reveal h1 { color: hotpink; }');
  });

  it('clear is a no-op when no footer block is present', () => {
    expect(clearFooterBlock(USER_CSS)).toBe(USER_CSS);
  });

  it('round-trips set → clear back to a footer-free state idempotently', () => {
    const cleared1 = clearFooterBlock(setFooterBlock(USER_CSS, 'x'));
    const cleared2 = clearFooterBlock(setFooterBlock(cleared1, 'x'));
    expect(cleared2).toBe(cleared1);
  });

  it('emits a local logo rule and ignores external/data URLs (offline-first)', () => {
    const local = buildFooterBlock('Co', 'assets/logo.png');
    expect(local).toContain('background-image: url("assets/logo.png");');
    expect(local).toContain('::before');

    const remote = buildFooterBlock('Co', 'https://evil.example/logo.png');
    expect(remote).not.toContain('background-image');
    expect(remote).not.toContain('::before');

    const data = buildFooterBlock('Co', 'data:image/png;base64,AAAA');
    expect(data).not.toContain('background-image');
  });

  it('CSS-escapes quotes and backslashes in the footer text', () => {
    const out = buildFooterBlock('a "quote" and \\ slash');
    expect(out).toContain('content: "a \\"quote\\" and \\\\ slash";');
  });

  it('parseFooterBlock round-trips text and logo', () => {
    const css = setFooterBlock(USER_CSS, 'My "Deck"', 'assets/logo.svg');
    const parsed = parseFooterBlock(css);
    expect(parsed).not.toBeNull();
    expect(parsed?.text).toBe('My "Deck"');
    expect(parsed?.logoSrc).toBe('assets/logo.svg');
    expect(parseFooterBlock(USER_CSS)).toBeNull();
  });
});
