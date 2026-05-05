/** @type {import('tailwindcss').Config} */
//
// Theme is toggled via .theme-light / .theme-dark on <html>. Color tokens are
// declared as space-separated RGB triples in index.css and consumed here via
// `rgb(var(--token) / <alpha-value>)` so Tailwind opacity modifiers work
// (e.g. `bg-paper/10`, `text-muted/70`).
//
// `edge` is a hairline border. It is set in CSS as a full rgba (not a triple)
// so opacity modifiers don't apply to it — it is always the same hairline.
//
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink:        "rgb(var(--ink) / <alpha-value>)",
        base:       "rgb(var(--ink) / <alpha-value>)",
        surface:    "rgb(var(--surface) / <alpha-value>)",
        paper:      "rgb(var(--paper) / <alpha-value>)",
        muted:      "rgb(var(--muted) / <alpha-value>)",
        edge:       "var(--edge)",                       // full rgba — no opacity modifier
        accent:     "rgb(var(--champagne) / <alpha-value>)",
        "accent-light": "rgb(var(--champagne-light) / <alpha-value>)",
        champagne:  "rgb(var(--champagne) / <alpha-value>)",
        "champagne-light": "rgb(var(--champagne-light) / <alpha-value>)",
        cream:      "rgb(var(--cream) / <alpha-value>)",
        silver:     "rgb(var(--silver) / <alpha-value>)",
        good:       "rgb(var(--verdigris) / <alpha-value>)",
        partial:    "rgb(var(--ochre) / <alpha-value>)",
        bad:        "rgb(var(--brick) / <alpha-value>)",
        sage:       "rgb(var(--sage) / <alpha-value>)",
        ochre:      "rgb(var(--ochre) / <alpha-value>)",
        brick:      "rgb(var(--brick) / <alpha-value>)",
        verdigris:        "rgb(var(--verdigris) / <alpha-value>)",
        "verdigris-light": "rgb(var(--verdigris-light) / <alpha-value>)",
      },
      fontFamily: {
        sans:    ["Inter", "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "Fira Code", "monospace"],
        display: ["Inter", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        "wordmark": "0.22em",
      },
    },
  },
  plugins: [],
}
