/**
 * api.ts — Typed fetch wrappers for the Lane GO asset/provider/shared endpoints.
 *
 * WHY A SEPARATE MODULE (not inline in components):
 *   • Testable with mocked `fetch` without mounting Svelte components.
 *   • Single source of truth for the URL contracts — if Lane GO renames an
 *     endpoint, one file changes.
 *   • Components stay thin: they call these functions and react to results.
 *
 * ENDPOINT CONTRACTS (the integrator reconciled these to match the Go server
 * exactly — internal/server/server.go — which is the single source of truth):
 *
 *   POST /api/decks/{name}/assets
 *     Body: FormData { file: File }
 *     Response: { src: "assets/img/photo.jpg", transcoded?: boolean }
 *     Status: 200
 *
 *   GET /api/shared
 *     Response: { name, rel_src, mime_type, size }[]   (mapped here → SharedFile)
 *     Status: 200
 *
 *   POST /api/shared/{filename}/copy?deck={deckName}
 *     Response: { src: "assets/img/logo.png" }
 *     Status: 200
 *     Note: copies the shared file INTO the deck (spec 08 — never a cross-deck ref).
 *
 *   GET /api/providers
 *     Response: { name, label }[]   (ENABLED providers only; absent key → omitted)
 *     Status: 200
 *
 *   GET /api/providers/{providerName}/search?q={query}&page={n}
 *     Response: { results: ProviderResult[], page, total_pages }
 *     Status: 200 (400 missing q, 403 disabled, 404 unknown, 502 upstream)
 *
 *   POST /api/providers/{providerName}/fetch
 *     Body: JSON { id: string, deck: string }
 *     Response: { src: "assets/img/photo.jpg" }   (downloaded + localized)
 *     Status: 200
 *
 * SECRETS: provider API keys live in env vars server-side only (spec 12 §5 /
 * spec 13).  The frontend never sees or sends keys.
 */

// ── Shared types ──────────────────────────────────────────────────────────────

/**
 * A file in the shared/ library, normalized for the UI.
 *
 * The server (GET /api/shared) returns `{ name, rel_src, mime_type, size }`;
 * {@link listShared} maps that to this shape: `path` ← rel_src, `url` ← the
 * read-only preview route the Go server serves shared files from (/shared/...).
 */
export interface SharedFile {
  /** Relative path from workspace root, e.g. "shared/logo.svg" (server rel_src). */
  path: string;
  /** Bare filename, e.g. "logo.svg" — what the copy endpoint expects. */
  name: string;
  /** Preview URL served by the Go server's read-only /shared/ route. */
  url: string;
  /** MIME type, e.g. "image/png". */
  mime?: string;
}

/** Raw GET /api/shared entry (Go assets.SharedEntry). */
interface SharedEntryRaw {
  name: string;
  rel_src: string;
  mime_type: string;
  size: number;
}

/**
 * A registered image provider (GET /api/providers).
 *
 * The Go server returns ONLY enabled providers (those with an API key set), so
 * `enabled` is always true here; it is retained so the picker UI can keep its
 * "no providers enabled" empty-state logic (an empty list → none enabled).
 */
export interface Provider {
  /** Unique machine name, e.g. "unsplash" or "giphy". */
  name: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Always true (server omits disabled providers). */
  enabled: boolean;
}

/** Raw GET /api/providers entry (Go provider.ProviderInfo). */
interface ProviderInfoRaw {
  name: string;
  label: string;
}

/** One search result from a provider (matches Go provider.SearchResult). */
export interface ProviderResult {
  /** Provider-internal id, echoed back to POST /fetch to localize the asset. */
  id: string;
  /** Thumbnail URL (external CDN — used only for the preview grid, never
   *  embedded in the deck). The localize step (POST /fetch) downloads it. */
  thumb_url: string;
  /** Description / alt-text suggestion from the provider metadata. */
  description?: string;
  /** Intrinsic width in px (provider metadata; optional). */
  width?: number;
  /** Intrinsic height in px (provider metadata; optional). */
  height?: number;
}

/** Envelope returned by GET /api/providers/{name}/search. */
interface ProviderSearchResponse {
  results: ProviderResult[];
  page: number;
  total_pages: number;
}

/** Response shape from POST /api/decks/{name}/assets and /copy-shared / /fetch. */
interface AssetResponse {
  /** Relative path from deck root, e.g. "assets/photo-abc123.jpg". */
  src: string;
}

// ── Asset upload (P5-4) ───────────────────────────────────────────────────────

/**
 * Upload a File to the deck's assets/ directory via multipart POST.
 *
 * Returns the relative `src` string to use in an <img> element.
 * Throws if the HTTP response is not 2xx.
 */
export async function uploadAsset(deckName: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/decks/${encodeURIComponent(deckName)}/assets`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`upload failed: HTTP ${res.status} ${res.statusText}`);
  }
  const data: AssetResponse = await res.json();
  return data.src;
}

// ── Shared library (P5-5) ────────────────────────────────────────────────────

/**
 * List all files in the shared/ library, normalized to {@link SharedFile}.
 * Returns an empty array when the shared/ directory is absent or empty.
 */
export async function listShared(): Promise<SharedFile[]> {
  const res = await fetch('/api/shared', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`listShared failed: HTTP ${res.status}`);
  }
  const data: SharedEntryRaw[] = await res.json();
  if (!Array.isArray(data)) return [];
  // Map the server shape → the UI shape. The preview URL is the read-only
  // /shared/ route the Go server serves the file from (rel_src already includes
  // the "shared/" prefix, so a leading slash makes an absolute same-origin URL).
  return data.map((e) => ({
    path: e.rel_src,
    name: e.name,
    url: `/${e.rel_src}`,
    mime: e.mime_type,
  }));
}

/**
 * Copy a shared/ file into the deck's assets/ directory (server-side copy,
 * not a cross-deck reference — spec 08).
 *
 * `filename` is the bare shared filename (e.g. "logo.svg", the `name` field of a
 * {@link SharedFile}); the server matches it strictly against shared/<filename>.
 * Returns the relative `src` string to use in an <img>.
 */
export async function copySharedAsset(
  deckName: string,
  filename: string,
): Promise<string> {
  const params = new URLSearchParams({ deck: deckName });
  const res = await fetch(
    `/api/shared/${encodeURIComponent(filename)}/copy?${params}`,
    { method: 'POST' },
  );
  if (!res.ok) {
    throw new Error(`copySharedAsset failed: HTTP ${res.status}`);
  }
  const data: AssetResponse = await res.json();
  return data.src;
}

// ── Image providers (P5-7, P5-8) ────────────────────────────────────────────

/**
 * List available image providers and their enabled status.
 * A provider is disabled when its API key is absent from the server env
 * (spec 12 §5 — keys are server-side only, never sent to the frontend).
 */
export async function listProviders(): Promise<Provider[]> {
  const res = await fetch('/api/providers', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`listProviders failed: HTTP ${res.status}`);
  }
  const data: ProviderInfoRaw[] = await res.json();
  if (!Array.isArray(data)) return [];
  // The server only returns providers whose key is configured → all enabled.
  return data.map((p) => ({ name: p.name, label: p.label, enabled: true }));
}

/**
 * Search a provider for images matching `query`.
 * `deckName` is forwarded so the server can enforce per-deck rate limits or
 * cache context.
 *
 * Returns an empty array when offline, key absent, or no results — callers
 * treat this as an empty state, not an error.
 */
export async function searchProvider(
  providerName: string,
  query: string,
  page = 1,
): Promise<ProviderResult[]> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  const res = await fetch(
    `/api/providers/${encodeURIComponent(providerName)}/search?${params}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    // Non-2xx when offline / key revoked.  Degrade gracefully.
    return [];
  }
  const data: ProviderSearchResponse = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

/**
 * Localize a provider result into the deck's assets/ directory.
 *
 * Lane GO downloads `result.full_url` (the external image) into
 * `decks/{deckName}/assets/`, giving the file a stable local name, and returns
 * the relative `src`.  After this call, the deck is self-contained and offline-
 * ready (spec 08, 12).
 */
export async function fetchProviderImage(
  deckName: string,
  providerName: string,
  result: ProviderResult,
): Promise<string> {
  const res = await fetch(
    `/api/providers/${encodeURIComponent(providerName)}/fetch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The server re-resolves the download URL from the provider id server-side
      // (so the client never has to know the upstream URL scheme).
      body: JSON.stringify({ id: result.id, deck: deckName }),
    },
  );
  if (!res.ok) {
    throw new Error(`fetchProviderImage failed: HTTP ${res.status}`);
  }
  const data: AssetResponse = await res.json();
  return data.src;
}
