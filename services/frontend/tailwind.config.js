/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--canvas) / <alpha-value>)",
        panel: "rgb(var(--canvas-soft) / <alpha-value>)",
        light: "rgb(var(--canvas-light) / <alpha-value>)",
        paper: "rgb(var(--canvas-paper) / <alpha-value>)",
        border: "rgb(var(--hairline-soft) / <alpha-value>)",
        hairline: "rgb(var(--hairline) / <alpha-value>)",
        text: "rgb(var(--on-primary) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        inkSoft: "rgb(var(--ink-soft) / <alpha-value>)",
        graphite: "rgb(var(--graphite) / <alpha-value>)",
        slate: "rgb(var(--slate) / <alpha-value>)",
        slateSoft: "rgb(var(--slate-soft) / <alpha-value>)",
        muted: "rgb(var(--mute) / <alpha-value>)",
        ash: "rgb(var(--ash) / <alpha-value>)",
        accent: "rgb(var(--brand) / <alpha-value>)",
        brandDeep: "rgb(var(--brand-deep) / <alpha-value>)",
        accent2: "rgb(var(--link-blue-soft) / <alpha-value>)",
        linkBlue: "rgb(var(--link-blue) / <alpha-value>)",
        linkBlueSoft: "rgb(var(--link-blue-soft) / <alpha-value>)",
        ok: "rgb(var(--success) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        err: "rgb(var(--error) / <alpha-value>)",
        info: "rgb(var(--surface-blue-bg) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["'waldenburgNormal'", "'ABC Walden'", "'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'waldenburgNormal'", "'ABC Walden'", "'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        softdrop: "0 4px 24px rgba(0, 0, 0, 0.08)",
      },
    },
  },
  plugins: [],
};
