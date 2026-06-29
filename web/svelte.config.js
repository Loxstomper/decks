import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Minimal Svelte config. Its primary purpose is to give svelte-check a stable
// preprocessing entry point: without it, svelte-check tries to derive the Svelte
// setup from vite.config.ts and intermittently fails to detect the plugin
// ("No Svelte configuration found in vite config"). The actual Vite build still
// reads its plugin list from vite.config.ts.
export default {
  preprocess: vitePreprocess(),
};
