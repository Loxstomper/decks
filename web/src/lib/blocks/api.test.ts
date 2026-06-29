/**
 * api.test.ts — Unit tests for the Lane GO fetch wrappers (api.ts).
 *
 * Uses vitest's global `fetch` mock (vi.stubGlobal) so we test the request
 * shape and response parsing without a real Go server.  Each test suite resets
 * the mock so tests are independent.
 *
 * We test:
 *  • Correct URL construction (including encodeURIComponent for deck names with
 *    spaces or special chars).
 *  • Correct HTTP method / headers / body shape.
 *  • Happy-path response parsing.
 *  • Error handling: non-2xx throws; malformed JSON still returns usable state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  uploadAsset,
  listShared,
  copySharedAsset,
  listProviders,
  searchProvider,
  fetchProviderImage,
  type ProviderResult,
} from './api';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown): void {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(JSON.parse(json)),
      text: () => Promise.resolve(json),
    }),
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

// ── uploadAsset ───────────────────────────────────────────────────────────────

describe('uploadAsset', () => {
  it('POSTs to /api/decks/{name}/assets with FormData', async () => {
    mockFetch(200, { src: 'assets/img/photo.jpg', transcoded: false });
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const src = await uploadAsset('my-deck', file);

    expect(src).toBe('assets/img/photo.jpg');
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/decks/my-deck/assets');
    expect(opts?.method).toBe('POST');
    expect(opts?.body).toBeInstanceOf(FormData);
  });

  it('encodes deck name with special characters in URL', async () => {
    mockFetch(201, { src: 'assets/img.png' });
    const file = new File(['x'], 'img.png', { type: 'image/png' });
    await uploadAsset('my deck/test', file);
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe('/api/decks/my%20deck%2Ftest/assets');
  });

  it('throws on non-2xx response', async () => {
    mockFetch(500, {});
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await expect(uploadAsset('deck', file)).rejects.toThrow('upload failed: HTTP 500');
  });
});

// ── listShared ────────────────────────────────────────────────────────────────

describe('listShared', () => {
  it('GETs /api/shared and maps the server shape → SharedFile', async () => {
    // Server (assets.SharedEntry) shape:
    mockFetch(200, [
      { name: 'logo.svg', rel_src: 'shared/logo.svg', mime_type: 'image/svg+xml', size: 1234 },
    ]);
    const result = await listShared();
    expect(result).toEqual([
      { path: 'shared/logo.svg', name: 'logo.svg', url: '/shared/logo.svg', mime: 'image/svg+xml' },
    ]);
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe('/api/shared');
  });

  it('returns an empty array when the server returns []', async () => {
    mockFetch(200, []);
    expect(await listShared()).toEqual([]);
  });

  it('throws on non-2xx', async () => {
    mockFetch(404, {});
    await expect(listShared()).rejects.toThrow('listShared failed: HTTP 404');
  });
});

// ── copySharedAsset ───────────────────────────────────────────────────────────

describe('copySharedAsset', () => {
  it('POSTs to /api/shared/{filename}/copy?deck={deck}', async () => {
    mockFetch(200, { src: 'assets/img/logo.svg' });
    const src = await copySharedAsset('deck1', 'logo.svg');
    expect(src).toBe('assets/img/logo.svg');

    const fetchMock = vi.mocked(globalThis.fetch);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/shared/logo.svg/copy?deck=deck1');
    expect(opts?.method).toBe('POST');
  });

  it('throws on non-2xx', async () => {
    mockFetch(404, {});
    await expect(copySharedAsset('deck', 'x.png')).rejects.toThrow(
      'copySharedAsset failed',
    );
  });
});

// ── listProviders ─────────────────────────────────────────────────────────────

describe('listProviders', () => {
  it('maps the server list (enabled providers only) → enabled:true', async () => {
    // Server returns only providers whose key is set, as { name, label }.
    mockFetch(200, [
      { name: 'unsplash', label: 'Unsplash' },
      { name: 'giphy', label: 'Giphy' },
    ]);
    expect(await listProviders()).toEqual([
      { name: 'unsplash', label: 'Unsplash', enabled: true },
      { name: 'giphy', label: 'Giphy', enabled: true },
    ]);
  });

  it('returns [] on non-array response (malformed)', async () => {
    mockFetch(200, null);
    // null is not an array → our guard returns []
    // but JSON.parse(null) is null, and Array.isArray(null) is false
    expect(await listProviders()).toEqual([]);
  });

  it('throws on non-2xx', async () => {
    mockFetch(503, {});
    await expect(listProviders()).rejects.toThrow('listProviders failed');
  });
});

// ── searchProvider ────────────────────────────────────────────────────────────

describe('searchProvider', () => {
  it('GETs with q and page params and unwraps the results envelope', async () => {
    const results = [
      { id: '1', thumb_url: 'https://example.com/t.jpg', description: 'sunset', width: 1920, height: 1080 },
    ];
    mockFetch(200, { results, page: 1, total_pages: 5 });
    const out = await searchProvider('unsplash', 'sunset');
    expect(out).toEqual(results);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toContain('/api/providers/unsplash/search');
    expect(url).toContain('q=sunset');
    expect(url).toContain('page=1');
  });

  it('returns [] on non-2xx (offline / key absent) instead of throwing', async () => {
    mockFetch(403, {});
    const out = await searchProvider('unsplash', 'mountain');
    expect(out).toEqual([]);
  });

  it('returns [] when the envelope has no results array', async () => {
    mockFetch(200, {});
    expect(await searchProvider('giphy', 'cat')).toEqual([]);
  });

  it('URL-encodes the provider name', async () => {
    mockFetch(200, { results: [], page: 1, total_pages: 0 });
    await searchProvider('my provider', 'q');
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toContain('/api/providers/my%20provider/search');
  });
});

// ── fetchProviderImage ────────────────────────────────────────────────────────

describe('fetchProviderImage', () => {
  const result: ProviderResult = {
    id: 'abc123',
    thumb_url: 'https://images.unsplash.com/thumb.jpg',
    description: 'mountain lake',
  };

  it('POSTs to /api/providers/{name}/fetch with id + deck', async () => {
    mockFetch(200, { src: 'assets/img/mountain-abc123.jpg' });
    const src = await fetchProviderImage('deck1', 'unsplash', result);
    expect(src).toBe('assets/img/mountain-abc123.jpg');

    const [url, opts] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe('/api/providers/unsplash/fetch');
    expect(opts?.method).toBe('POST');
    const body = JSON.parse(opts?.body as string);
    expect(body).toEqual({ id: 'abc123', deck: 'deck1' });
  });

  it('throws on non-2xx', async () => {
    mockFetch(502, {});
    await expect(fetchProviderImage('deck', 'unsplash', result)).rejects.toThrow(
      'fetchProviderImage failed',
    );
  });

  it('URL-encodes the provider name', async () => {
    mockFetch(200, { src: 'assets/img/img.gif' });
    await fetchProviderImage('deck', 'my giphy', result);
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe('/api/providers/my%20giphy/fetch');
  });
});
