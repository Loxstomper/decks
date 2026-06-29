/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{svelte,ts,js}',
  ],
  theme: {
    extend: {
      colors: {
        // Editor chrome colors — backed by CSS custom properties (spec 09).
        // Variables hold space-separated RGB channel triplets so Tailwind's
        // opacity modifier syntax (e.g. bg-surface/20) works correctly.
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          muted: 'rgb(var(--accent-muted) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
