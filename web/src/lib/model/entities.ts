/**
 * entities.ts — Minimal, deterministic HTML entity encode/decode.
 *
 * WHY: attribute and text VALUES are stored in *source form* (entities left
 * exactly as authored) so untouched nodes round-trip byte-for-byte. But the
 * editor API hands callers *literal* strings (`getAttribute` returns `a&b`, not
 * `a&amp;b`) and accepts literals (`setAttribute(el,'x','a&b')`). These helpers
 * bridge source-form <-> literal without ever touching untouched bytes.
 *
 * Decoding is liberal (covers the common named refs + numeric refs, leaves
 * unknown refs untouched). Encoding is conservative and *minimal* — it escapes
 * only the characters that are syntactically significant — so the output is
 * stable and predictable (no gratuitous entity churn).
 */

const NAMED_DECODE: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode HTML entities in source-form text into a literal string. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      // Guard against NaN / out-of-range; leave malformed refs verbatim.
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    const named = NAMED_DECODE[body];
    return named !== undefined ? named : whole;
  });
}

/**
 * Encode a literal string into source form suitable for an attribute value.
 * Escapes `&`, `<`, `>`, and `"` (the latter so it is safe inside double
 * quotes). `&` is escaped first to avoid double-encoding.
 */
export function encodeAttr(literal: string): string {
  return literal
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Encode a literal string into source form suitable for text content. Escapes
 * `&`, `<`, `>` (quotes are not special in text).
 */
export function encodeText(literal: string): string {
  return literal
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
