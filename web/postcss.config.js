export default {
  plugins: {
    // Tailwind v4 moved the PostCSS plugin into its own package, and folded
    // vendor-prefixing in, so autoprefixer is no longer needed here.
    '@tailwindcss/postcss': {},
  },
};
