/**
 * validate.ts — Client-side deck validation (P8-3 / spec claude-code-integration "slides validate").
 *
 * WHY THIS EXISTS:
 * ================
 * Both Claude Code and the editor's save path write `deck.html`; spec claude-code-integration says a
 * malformed deck must be "caught instead of silently breaking the canvas". The
 * single source of truth for validation is the Go `slides validate` /
 * POST /api/decks/{name}/validate endpoint, but the editor ALSO keeps this fast,
 * synchronous, offline guard so:
 *
 *   • a save that would break the model is surfaced even when the backend
 *     endpoint is unavailable, and
 *   • we never have to round-trip the network to know the obvious cases
 *     (unparseable HTML, duplicate eids, illegal layout-contract values).
 *
 * This mirrors the layout-contract checks already enforced (by THROWING) in
 * layout.ts, but here they are NON-throwing: we collect every problem so the UI
 * can show the user the full list and let THEM decide, rather than aborting on
 * the first error (spec claude-code-integration "show the errors and let the user decide").
 *
 * PURE: parse + tree walk only, no DOM, fully unit-testable (validate.test.ts).
 */

import { parseDeck } from './parse';
import { serializeDeck } from './serialize';
import { walk, getAttribute } from './edit';
import type { DeckModel, ElementNode } from './types';

/** A single validation problem. `code` is machine-stable; `message` is for humans. */
export interface ValidationError {
  /** Stable machine code, e.g. 'parse' | 'round-trip' | 'duplicate-eid' | 'bad-lay'. */
  code: string;
  /** Human-readable description shown in the validation banner. */
  message: string;
  /** The offending element's `data-eid`, when one can be attributed. */
  eid?: string;
}

/** The outcome of validating a deck. `ok === (errors.length === 0)`. */
export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

// ─── Layout-contract allowed value sets (spec layout-vocabulary) ───────────────────────────

const LAY_VALUES = new Set(['stack', 'row', 'grid', 'layers']);
const ALIGN_VALUES = new Set(['start', 'center', 'end', 'stretch']);
const JUSTIFY_VALUES = new Set(['start', 'center', 'end', 'between', 'around']);

/** Match a clean signed integer string ("0", "24", "-3"). */
const INT_RE = /^-?\d+$/;
/** Match a clean (optionally signed/decimal) number string for free coords. */
const NUM_RE = /^-?\d+(?:\.\d+)?$/;

/** Parse an integer attribute; returns null if the raw string is not a clean int. */
function asInt(raw: string): number | null {
  return INT_RE.test(raw.trim()) ? parseInt(raw, 10) : null;
}

/**
 * Validate the layout contract (spec layout-vocabulary) across a parsed model: enum values are
 * legal, numeric attributes are well-formed and in-range, and every `data-eid`
 * is unique. Returns ALL problems found (does not stop at the first).
 *
 * Exposed separately from {@link validateSource} so tests can feed a model
 * directly and so callers that already hold a model avoid re-parsing.
 */
export function validateModel(model: DeckModel): ValidationResult {
  const errors: ValidationError[] = [];
  const seenEids = new Map<string, number>();

  walk(model, (node) => {
    if (node.type !== 'element') return;
    const el = node as ElementNode;
    const eid = getAttribute(el, 'data-eid') ?? undefined;

    // ── Unique data-eid (spec document-model): a duplicate breaks selection + Claude targeting.
    if (eid) seenEids.set(eid, (seenEids.get(eid) ?? 0) + 1);

    // ── Enum attributes (spec layout-vocabulary LAYOUT CONTRACT) ──────────────────────────
    checkEnum(errors, el, eid, 'data-lay', LAY_VALUES);
    checkEnum(errors, el, eid, 'data-align', ALIGN_VALUES);
    checkEnum(errors, el, eid, 'data-justify', JUSTIFY_VALUES);

    // ── Non-negative integers: gap / pad / grow ────────────────────────────
    checkNonNegInt(errors, el, eid, 'data-gap');
    checkNonNegInt(errors, el, eid, 'data-pad');
    checkNonNegInt(errors, el, eid, 'data-grow');

    // ── Positive integer: span (>= 1) ──────────────────────────────────────
    const spanRaw = getAttribute(el, 'data-span');
    if (spanRaw !== null) {
      const n = asInt(spanRaw);
      if (n === null || n < 1) {
        errors.push({
          code: 'bad-span',
          message: `data-span must be an integer >= 1 (got "${spanRaw}")`,
          eid,
        });
      }
    }

    // ── Free coordinates: x/y any number; w/h non-negative numbers ──────────
    checkNumber(errors, el, eid, 'data-x', false);
    checkNumber(errors, el, eid, 'data-y', false);
    checkNumber(errors, el, eid, 'data-w', true);
    checkNumber(errors, el, eid, 'data-h', true);
  });

  // Flag every eid used more than once (report once per duplicated id).
  for (const [eid, count] of seenEids) {
    if (count > 1) {
      errors.push({
        code: 'duplicate-eid',
        message: `data-eid "${eid}" is used ${count} times; eids must be unique`,
        eid,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

function checkEnum(
  errors: ValidationError[],
  el: ElementNode,
  eid: string | undefined,
  attr: string,
  allowed: Set<string>,
): void {
  const raw = getAttribute(el, attr);
  if (raw !== null && !allowed.has(raw)) {
    errors.push({
      code: `bad-${attr.replace('data-', '')}`,
      message: `${attr} must be one of {${[...allowed].join(', ')}} (got "${raw}")`,
      eid,
    });
  }
}

function checkNonNegInt(
  errors: ValidationError[],
  el: ElementNode,
  eid: string | undefined,
  attr: string,
): void {
  const raw = getAttribute(el, attr);
  if (raw === null) return;
  const n = asInt(raw);
  if (n === null || n < 0) {
    errors.push({
      code: `bad-${attr.replace('data-', '')}`,
      message: `${attr} must be a non-negative integer (got "${raw}")`,
      eid,
    });
  }
}

function checkNumber(
  errors: ValidationError[],
  el: ElementNode,
  eid: string | undefined,
  attr: string,
  nonNegative: boolean,
): void {
  const raw = getAttribute(el, attr);
  if (raw === null) return;
  const ok = NUM_RE.test(raw.trim());
  const n = ok ? parseFloat(raw) : NaN;
  if (!ok || (nonNegative && n < 0)) {
    errors.push({
      code: `bad-${attr.replace('data-', '')}`,
      message: `${attr} must be a${nonNegative ? ' non-negative' : ''} number (got "${raw}")`,
      eid,
    });
  }
}

/**
 * Validate a raw HTML source string end-to-end (the editor's save guard):
 *
 *   1. PARSE — it must parse without throwing.
 *   2. ROUND-TRIP IDEMPOTENCY — serialize(model) then re-parse+serialize must be
 *      byte-identical. If they diverge, persisting `source` would silently alter
 *      the document on the next load (a "save that would break the model"), so
 *      we surface it (spec document-model idempotent-round-trip invariant; spec claude-code-integration "HTML
 *      parses and round-trips").
 *   3. LAYOUT CONTRACT — see {@link validateModel}.
 *
 * Returns the union of all problems; `ok` is true only when none are found.
 */
export function validateSource(html: string): ValidationResult {
  let model: DeckModel;
  try {
    model = parseDeck(html);
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          code: 'parse',
          message: `HTML failed to parse: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }

  const errors = validateModel(model).errors;

  // Round-trip idempotency: serialize(parse(x)) must be a fixed point.
  try {
    const s1 = serializeDeck(model);
    const s2 = serializeDeck(parseDeck(s1));
    if (s1 !== s2) {
      errors.push({
        code: 'round-trip',
        message:
          'Document does not round-trip stably; saving it would alter the markup on reload.',
      });
    }
  } catch (e) {
    errors.push({
      code: 'round-trip',
      message: `Re-parse of serialized output failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  return { ok: errors.length === 0, errors };
}

// ─── Remote (Go) validation — single source of truth, best-effort ───────────

/**
 * Call Lane A's `POST /api/decks/{name}/validate` (spec claude-code-integration "slides validate").
 *
 * Contract assumed (tolerant): the endpoint receives the HTML body and returns
 * JSON `{ ok: boolean, errors?: Array<{ code?, message, eid? }> }`. We map that
 * into a {@link ValidationResult}.
 *
 * Returns `null` (NOT a failure) when the endpoint is UNAVAILABLE — 404 (not yet
 * implemented), a non-2xx, a network error, or non-JSON. A null result means
 * "fall back to the client-side guard as the sole authority" so the editor keeps
 * working offline / before the backend lands the route (spec principles-and-invariants offline-first).
 */
export async function validateRemote(
  name: string,
  source: string,
): Promise<ValidationResult | null> {
  try {
    const res = await fetch(`/api/decks/${encodeURIComponent(name)}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: source,
    });
    if (!res.ok) return null; // 404 / 5xx → endpoint unavailable, use local guard
    const data: unknown = await res.json();
    return normalizeRemote(data);
  } catch {
    return null; // network error / non-JSON → fall back to local guard
  }
}

/**
 * Normalise an arbitrary JSON payload from the validate endpoint into a
 * {@link ValidationResult}, defensively (the backend may evolve its shape).
 * Exposed for unit testing of the mapping logic without a live server.
 */
export function normalizeRemote(data: unknown): ValidationResult | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  const rawErrors = Array.isArray(obj.errors) ? obj.errors : [];
  const errors: ValidationError[] = rawErrors.map((e) => {
    if (typeof e === 'string') return { code: 'remote', message: e };
    const eo = (e ?? {}) as Record<string, unknown>;
    return {
      code: typeof eo.code === 'string' ? eo.code : 'remote',
      message:
        typeof eo.message === 'string'
          ? eo.message
          : typeof eo.msg === 'string'
            ? eo.msg
            : 'validation error',
      eid: typeof eo.eid === 'string' ? eo.eid : undefined,
    };
  });

  // Prefer an explicit `ok`; otherwise derive it from the presence of errors.
  const ok = typeof obj.ok === 'boolean' ? obj.ok : errors.length === 0;
  return { ok, errors };
}
