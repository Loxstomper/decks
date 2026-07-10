/**
 * parse.ts — Source-preserving HTML parser (P1-4 / spec document-model).
 *
 * Produces a {@link DeckModel}: a real, mutable element tree in which every node
 * additionally records its exact original source slice (`raw`). See types.ts for
 * the rationale (byte-stable round-trip / never-destroy-the-unknown).
 *
 * Scope: this is a pragmatic parser for the well-formed HTML that reveal decks
 * use (explicit closing tags; the editor and `decks validate` gate malformed
 * input — spec claude-code-integration/principles-and-invariants). It handles the edge cases that actually occur in
 * AI-authored decks and that the golden corpus exercises:
 *   - elements, attributes (quoted / unquoted / boolean), case preserved
 *   - void elements and XML-style `/>` self-closing
 *   - raw-text elements (`script`, `style`, `textarea`, `title`) read verbatim
 *   - comments, CDATA sections, `<!DOCTYPE>` / declarations, `<?…?>`
 *   - HTML entities (kept verbatim — never re-encoded)
 *   - unknown custom elements and unknown attributes (passthrough)
 *
 * It does NOT implement the HTML5 tag-omission / auto-closing algorithm (e.g.
 * implicit `</p>`). That is intentional: reveal decks are written with explicit
 * close tags, and full HTML5 tree construction would defeat byte-stable raw
 * preservation. Even for malformed input the worst case is an oddly-nested tree
 * whose `raw` slices still reassemble to the original bytes.
 */

import type {
  CdataNode,
  CommentNode,
  DeckModel,
  DoctypeNode,
  ElementNode,
  SlideNode,
  TextNode,
  NodeAttr,
} from './types';

// HTML void elements: never have a close tag or children.
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Raw-text / escapable-raw-text elements: content is taken verbatim until the
// matching close tag and is never parsed as markup.
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

interface Ctx {
  src: string;
  i: number;
}

/**
 * Parse a full `deck.html` document into a {@link DeckModel}.
 *
 * INVARIANT: `serializeDeck(parseDeck(html)) === html` for well-formed input
 * (verified by the golden corpus in model.test.ts).
 */
export function parseDeck(html: string): DeckModel {
  const ctx: Ctx = { src: html, i: 0 };
  const nodes = parseNodes(ctx, null);
  // Defensive: if anything was left unconsumed (shouldn't happen for the
  // grammar above), capture it verbatim so no bytes are ever dropped.
  if (ctx.i < html.length) {
    nodes.push(makeText(html.slice(ctx.i)));
    ctx.i = html.length;
  }
  return { source: html, nodes };
}

/** Parse a sequence of sibling nodes until EOF or an (ancestor) close tag. */
function parseNodes(ctx: Ctx, parentTag: string | null): SlideNode[] {
  const nodes: SlideNode[] = [];
  while (ctx.i < ctx.src.length) {
    // A close tag terminates the current element; the caller consumes it.
    if (ctx.src.startsWith('</', ctx.i)) break;
    const before = ctx.i;
    const node = parseNode(ctx);
    nodes.push(node);
    // Guard against any non-advancing branch (cannot happen, but keeps the
    // loop provably terminating).
    if (ctx.i === before) {
      nodes.push(makeText(ctx.src.slice(ctx.i)));
      ctx.i = ctx.src.length;
      break;
    }
  }
  void parentTag; // accepted for symmetry / future tag-aware recovery
  return nodes;
}

/** Parse a single node starting at `ctx.i`. */
function parseNode(ctx: Ctx): SlideNode {
  const { src } = ctx;
  if (src[ctx.i] === '<') {
    if (src.startsWith('<!--', ctx.i)) return parseComment(ctx);
    if (src.startsWith('<![CDATA[', ctx.i)) return parseCdata(ctx);
    if (src.startsWith('<!', ctx.i)) return parseDeclaration(ctx);
    if (src.startsWith('<?', ctx.i)) return parseDeclaration(ctx);
    // `<` followed by a letter starts an element; anything else is stray text.
    const next = src[ctx.i + 1] ?? '';
    if (/[a-zA-Z]/.test(next)) return parseElement(ctx);
    return parseText(ctx);
  }
  return parseText(ctx);
}

/** Text run: up to the next `<` (consuming at least one char to ensure
 *  progress when sitting on a stray `<`). */
function parseText(ctx: Ctx): TextNode {
  const { src } = ctx;
  const start = ctx.i;
  if (src[ctx.i] === '<') ctx.i++; // stray '<' that did not start a tag
  while (ctx.i < src.length && src[ctx.i] !== '<') ctx.i++;
  const value = src.slice(start, ctx.i);
  return makeText(value);
}

function parseComment(ctx: Ctx): CommentNode {
  const { src } = ctx;
  const start = ctx.i;
  const innerStart = ctx.i + 4; // past '<!--'
  const close = src.indexOf('-->', innerStart);
  const end = close === -1 ? src.length : close + 3;
  ctx.i = end;
  return {
    type: 'comment',
    value: src.slice(innerStart, close === -1 ? src.length : close),
    raw: src.slice(start, end),
    dirty: false,
  };
}

function parseCdata(ctx: Ctx): CdataNode {
  const { src } = ctx;
  const start = ctx.i;
  const innerStart = ctx.i + 9; // past '<![CDATA['
  const close = src.indexOf(']]>', innerStart);
  const end = close === -1 ? src.length : close + 3;
  ctx.i = end;
  return {
    type: 'cdata',
    value: src.slice(innerStart, close === -1 ? src.length : close),
    raw: src.slice(start, end),
    dirty: false,
  };
}

/** `<!DOCTYPE …>`, `<!… >` markup declarations, or `<?…?>` processing
 *  instructions: everything up to the next `>`. */
function parseDeclaration(ctx: Ctx): DoctypeNode {
  const { src } = ctx;
  const start = ctx.i;
  const close = src.indexOf('>', ctx.i);
  const end = close === -1 ? src.length : close + 1;
  ctx.i = end;
  return { type: 'doctype', raw: src.slice(start, end), dirty: false };
}

function parseElement(ctx: Ctx): ElementNode {
  const { src } = ctx;
  const start = ctx.i;

  // --- tag name ---
  let j = ctx.i + 1;
  const nameStart = j;
  while (j < src.length && !/[\s/>]/.test(src[j])) j++;
  const tagName = src.slice(nameStart, j);

  // --- scan to the closing '>' of the open tag, respecting quoted values ---
  let k = j;
  let quote: string | null = null;
  while (k < src.length) {
    const c = src[k];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      break;
    }
    k++;
  }
  const openTagEnd = k < src.length ? k + 1 : src.length;
  const rawOpen = src.slice(start, openTagEnd);
  // attribute text = between end-of-name and the '>' (minus a trailing '/').
  const attrText = src.slice(j, k).replace(/\/\s*$/, '');
  const selfClosing = /\/\s*$/.test(src.slice(j, k));
  const attributes = parseAttributes(attrText);
  ctx.i = openTagEnd;

  const lname = tagName.toLowerCase();
  const isVoid = VOID_ELEMENTS.has(lname);
  const rawText = RAW_TEXT_ELEMENTS.has(lname);

  const node: ElementNode = {
    type: 'element',
    tagName,
    attributes,
    children: [],
    rawOpen,
    rawClose: '',
    selfClosing,
    isVoid,
    rawText,
    raw: rawOpen, // updated below once children/close are known
    dirty: false,
  };

  // Void or self-closing: no children, no close tag.
  if (isVoid || selfClosing) {
    node.raw = src.slice(start, ctx.i);
    return node;
  }

  if (rawText) {
    const close = findRawTextClose(src, ctx.i, lname);
    const content = src.slice(ctx.i, close);
    if (content.length > 0) node.children.push(makeText(content));
    ctx.i = close;
    node.rawClose = consumeCloseTag(ctx, tagName);
    node.raw = src.slice(start, ctx.i);
    return node;
  }

  node.children = parseNodes(ctx, lname);
  node.rawClose = consumeCloseTag(ctx, tagName);
  node.raw = src.slice(start, ctx.i);
  return node;
}

/** Locate the matching `</tag` of a raw-text element (case-insensitive). */
function findRawTextClose(src: string, from: number, lname: string): number {
  const lower = src.toLowerCase();
  const idx = lower.indexOf('</' + lname, from);
  return idx === -1 ? src.length : idx;
}

/** Consume `</tag …>` if the next token is the matching close tag; otherwise
 *  leave `ctx.i` untouched (unclosed or mismatched element) and return ''. */
function consumeCloseTag(ctx: Ctx, tagName: string): string {
  const { src } = ctx;
  if (!src.startsWith('</', ctx.i)) return '';
  let j = ctx.i + 2;
  const nameStart = j;
  while (j < src.length && !/[\s/>]/.test(src[j])) j++;
  const name = src.slice(nameStart, j);
  if (name.toLowerCase() !== tagName.toLowerCase()) return '';
  let k = j;
  while (k < src.length && src[k] !== '>') k++;
  const end = k < src.length ? k + 1 : src.length;
  const raw = src.slice(ctx.i, end);
  ctx.i = end;
  return raw;
}

/** Parse the attribute portion of an open tag into ordered name/value pairs.
 *  Values are kept in *source form* (entities intact). */
function parseAttributes(s: string): NodeAttr[] {
  const attrs: NodeAttr[] = [];
  let i = 0;
  const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  while (i < s.length) {
    while (i < s.length && isWs(s[i])) i++;
    if (i >= s.length) break;
    // attribute name: up to whitespace, '=', '/', or '>'
    const nameStart = i;
    while (i < s.length && !isWs(s[i]) && s[i] !== '=' && s[i] !== '/' && s[i] !== '>') i++;
    const name = s.slice(nameStart, i);
    if (name === '') {
      // Stray character (e.g. a lone '/'): skip it so we always make progress.
      i++;
      continue;
    }
    // look past whitespace for an '='
    let k = i;
    while (k < s.length && isWs(s[k])) k++;
    if (s[k] === '=') {
      k++;
      while (k < s.length && isWs(s[k])) k++;
      let value: string;
      const q = s[k];
      if (q === '"' || q === "'") {
        const vStart = k + 1;
        let v = vStart;
        while (v < s.length && s[v] !== q) v++;
        value = s.slice(vStart, v);
        k = v < s.length ? v + 1 : v;
      } else {
        const vStart = k;
        while (k < s.length && !isWs(s[k])) k++;
        value = s.slice(vStart, k);
      }
      attrs.push({ name, value });
      i = k;
    } else {
      attrs.push({ name, value: null });
      i = k;
    }
  }
  return attrs;
}

/** Construct a text node whose source form equals its value (parsed text). */
function makeText(value: string): TextNode {
  return { type: 'text', value, raw: value, dirty: false };
}
