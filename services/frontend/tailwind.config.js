/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0c",
        panel: "#111114",
        border: "#1f1f25",
        muted: "#7a7a85",
        text: "#e8e8ee",
        accent: "#ff3d57",
        accent2: "#7c5cff",
        ok: "#22c55e",
        warn: "#f59e0b",
        err: "#ef4444",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,61,87,.2), 0 8px 30px rgba(255,61,87,.15)",
      },
    },
  },
  plugins: [],
};
