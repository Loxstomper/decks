/**
 * blocks/text.ts — Text block builders (P5-2 / spec 03 "Text (heading / paragraph / list)").
 *
 * Pure functions that return fresh model subtrees built only from the edit.ts
 * factories. Every node comes back `dirty` (createElement/createText set it), so
 * the serializer renders it canonically; once inserted + saved + re-parsed it
 * round-trips byte-stably like any hand-authored block.
 *
 * The inserted text is a normal leaf (`h1..h6` / `p` / `ul` / `ol`), so the
 * Phase-2 contenteditable surface picks it up automatically — no special wiring
 * needed for the text to be editable and persist.
 */

import { createElement, createText, appendChild } from '$lib/model/edit';
import type { ElementNode } from '$lib/model/types';

/** Heading levels the palette offers. h2 is the body-slide default (h1 is the deck title). */
export type HeadingLevel = 1 | 2 | 3;

/**
 * A heading (`<h1>`/`<h2>`/`<h3>`). Defaults to h2 with placeholder text the
 * user immediately edits in place.
 */
export function buildHeading(text = 'Heading', level: HeadingLevel = 2): ElementNode {
  const h = createElement(`h${level}`);
  appendChild(h, createText(text));
  return h;
}

/** A paragraph (`<p>`) with placeholder body text. */
export function buildParagraph(text = 'Body text.'): ElementNode {
  const p = createElement('p');
  appendChild(p, createText(text));
  return p;
}

/**
 * A bullet (`<ul>`) or numbered (`<ol>`) list. Each item is an `<li>` holding a
 * single text node so it is directly editable.
 */
export function buildList(
  items: string[] = ['First item', 'Second item', 'Third item'],
  ordered = false,
): ElementNode {
  const list = createElement(ordered ? 'ol' : 'ul');
  // Always emit at least one item so the list is visible/selectable on insert.
  const safe = items.length > 0 ? items : [''];
  for (const item of safe) {
    const li = createElement('li');
    appendChild(li, createText(item));
    appendChild(list, li);
  }
  return list;
}
