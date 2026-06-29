import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

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
  plugins: [svelte()],

  server: {
    port: 5173,
    proxy: {
      '/api': {
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
