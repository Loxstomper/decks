import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

// `emptyOutDir: true` wipes web/dist on every build, including the committed
// web/dist/.gitkeep that go:embed (web/embed.go, `//go:embed all:dist`) relies on
// to compile on a fresh clone *before* the first `npm run build`. This plugin
// re-creates that placeholder after the bundle is written so the tracked file
// always exists and the git tree stays clean.
const keepEmbedPlaceholder = {
  name: 'keep-embed-placeholder',
  closeBundle() {
    writeFileSync(
      fileURLToPath(new URL('./dist/.gitkeep', import.meta.url)),
      'Placeholder so go:embed (web/embed.go) has an embeddable file on a fresh\n' +
        'clone before `npm run build`. Recreated by vite.config.ts after each build.\n',
    );
  },
};

// The Go backend's default port is 3000 (internal/config default; override in config.toml).
// Keep this in sync with that default so `npm run dev` proxies correctly out of the box.
// /api  — REST endpoints (deck CRUD, config, etc.)
// /events — SSE stream (fsnotify file-changed events)
//
// SSE requires no buffering: changeOrigin + the specific headers below prevent the
// proxy from accumulating data before forwarding.
const GO_PORT = process.env.GO_PORT ?? '3000';
const GO_ORIGIN = `http://localhost:${GO_PORT}`;

export default defineConfig({
  plugins: [svelte(), keepEmbedPlaceholder],

  // `$lib/...` resolves to web/src/lib (matches the tsconfig `paths` mapping so
  // build, dev and vitest all agree). Components import e.g. `$lib/coords.ts`.
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: GO_ORIGIN,
        changeOrigin: true,
      },
      // Static deck files (deck.html + assets/) served by the Go backend so the
      // iframe can load /decks/{name}/deck.html during `npm run dev`.
      '/decks': {
        target: GO_ORIGIN,
        changeOrigin: true,
      },
      '/events': {
        target: GO_ORIGIN,
        changeOrigin: true,
        // Disable response buffering so SSE frames arrive immediately.
        // Vite's http-proxy uses Node's http module; setting these headers
        // and disabling the proxy's own buffering ensures each `data:` line
        // is forwarded as soon as the Go server sends it.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // Force streaming: prevent any intermediate buffering.
            proxyRes.headers['cache-control'] = 'no-cache';
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        },
      },
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
