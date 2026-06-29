/**
 * types.ts — DOM-as-model node types (P1-4 / spec 02).
 *
 * WHY A SOURCE-PRESERVING TREE (and not a re-serialized DOMParser document):
 * ==========================================================================
 * Spec principle #4 (specs/12) makes load -> save BYTE-STABLE for ARBITRARY
 * input HTML a *tested invariant*: the editor and Claude Code both write
 * `deck.html`, so any reformatting churn would make them fight each other.
 *
 * A `DOMParser` document CANNOT satisfy this. Re-serializing a DOM via
 * `outerHTML` normalizes the input in ways we do not control and cannot turn
 * off: entity (re)encoding (`&apos;` -> `'`), attribute re-quoting, dropped
 * vs. kept self-closing slashes, void-element handling, whitespace collapsing,
 * boolean-attribute rewriting, `<` in text, comment/CDATA edge cases, etc.
 * For odd / AI-authored / hand-written markup that is exactly the content we
 * must "never destroy" (spec 12), so a full re-serialize is the wrong tool.
 *
 * Instead we parse into a real, mutable element tree where **every node keeps
 * its exact original source slice** (`raw`). Serialization is then:
 *
 *   • untouched node  -> emit its original bytes verbatim (passthrough), so an
 *     unedited deck round-trips IDENTICALLY regardless of how it was authored.
 *   • edited node     -> emit canonical, deterministic markup (stable attribute
 *     order, stable quoting); only the subtree you actually changed is
 *     reformatted ("preserve the original serialization for untouched
 *     subtrees").
 *
 * This guarantees:
 *   serialize(parse(html)) === html               for any well-formed input
 *   parse(serialize(parse(html))) === serialize(parse(html))   (idempotent)
 * and keeps reformatting scoped to the exact element the user/Claude edited.
 *
 * The tree is still a faithful DOM-as-model (spec 02): elements, attributes,
 * children, comments, CDATA, doctype, raw-text (script/style) — all addressable
 * and mutable. It just additionally remembers where it came from.
 */

/** Discriminant for the node union. */
export type NodeType = 'element' | 'text' | 'comment' | 'cdata' | 'doctype';

/** A parsed attribute. `value` is stored in **source form** (entities intact,
 *  exactly as it appeared between the quotes); `null` means a boolean attribute
 *  with no `=value`. Use {@link getAttribute}/{@link setAttribute} for decoded
 *  literal access. */
export interface NodeAttr {
  name: string;
  value: string | null;
}

interface NodeBase {
  type: NodeType;
  /** Exact original source slice for this node (including all descendants for
   *  elements). The bedrock of byte-stable passthrough. Empty for nodes created
   *  programmatically (which are always emitted via the canonical renderer). */
  raw: string;
  /** True when this node's *own* markup was edited and must be re-rendered
   *  canonically instead of emitted verbatim. Descendant edits are detected
   *  separately (see serialize.ts), so a clean parent with a dirty child keeps
   *  its own original tag bytes while re-rendering only the changed child. */
  dirty: boolean;
}

export interface TextNode extends NodeBase {
  type: 'text';
  /** Text content in source form (entities intact). */
  value: string;
}

export interface CommentNode extends NodeBase {
  type: 'comment';
  /** Inner comment data between `<!--` and `-->`. */
  value: string;
}

export interface CdataNode extends NodeBase {
  type: 'cdata';
  /** Inner data between `<![CDATA[` and `]]>`. */
  value: string;
}

export interface DoctypeNode extends NodeBase {
  type: 'doctype';
}

export interface ElementNode extends NodeBase {
  type: 'element';
  /** Tag name preserved in its original case (e.g. `section`, `MyWidget`). */
  tagName: string;
  attributes: NodeAttr[];
  children: SlideNode[];
  /** Original open tag bytes, e.g. `<section class="x">`. */
  rawOpen: string;
  /** Original close tag bytes, e.g. `</section>`. Empty for void / self-closing
   *  / unclosed elements. */
  rawClose: string;
  /** Tag used the XML-style `/>` self-closing form. */
  selfClosing: boolean;
  /** HTML void element (`br`, `img`, `meta`, ...) — never has a close tag. */
  isVoid: boolean;
  /** Raw-text element (`script`, `style`, `textarea`, `title`) — its single
   *  text child is read verbatim and never parsed as markup. */
  rawText: boolean;
}

/** Any node in the model tree. */
export type SlideNode =
  | ElementNode
  | TextNode
  | CommentNode
  | CdataNode
  | DoctypeNode;

/**
 * The in-memory deck model. `source` is the original document text (kept so the
 * unedited round-trip is provably byte-identical); `nodes` is the top-level node
 * list (typically: doctype, whitespace, `<html>`).
 */
export interface DeckModel {
  source: string;
  nodes: SlideNode[];
}
