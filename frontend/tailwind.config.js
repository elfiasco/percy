/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        base:    "#0F1117",
        surface: "#1A1D26",
        edge:    "#2D3048",
        accent:  "#6366F1",
        "accent-light": "#818CF8",
        muted:   "#64748B",
        good:    "#22C55E",
        partial: "#F59E0B",
        bad:     "#EF4444",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
}

