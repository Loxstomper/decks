/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{svelte,ts,js}',
  ],
  theme: {
    extend: {
      colors: {
        // Editor chrome colors
        surface: {
          DEFAULT: '#1a1a2e',
          raised: '#16213e',
          overlay: '#0f3460',
        },
        accent: {
          DEFAULT: '#e94560',
          muted: '#533483',
        },
      },
    },
  },
  plugins: [],
};
