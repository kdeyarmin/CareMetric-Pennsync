export default {
  plugins: {
    // Tailwind v4 ships its own PostCSS plugin and handles imports + vendor
    // prefixing internally, so autoprefixer is no longer needed.
    "@tailwindcss/postcss": {},
  },
}
