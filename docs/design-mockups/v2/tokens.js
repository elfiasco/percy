// Four palettes × two modes = eight token sets.
// Each set defines the same CSS variable vocabulary; only the values change.
// Loaded by dashboard.html and applied via document.documentElement.style.

window.PERCY_PALETTES = {
  inkwell: {
    name: "I · Inkwell",
    story: "Cobalt fountain pen ink on cream-laid paper.",
    light: {
      "--bg-base":     "#F5F1E6",   // cream paper, slightly toothy
      "--bg-surface":  "#FBF8EE",   // page surface
      "--bg-sunk":     "#EDE7D4",
      "--text-primary":"#0E1426",   // ink-black with blue undertone
      "--text-secondary":"#3D4565",
      "--text-tertiary":"#7A819B",
      "--border-subtle":"rgba(14,20,38,0.08)",
      "--border-default":"rgba(14,20,38,0.14)",
      "--border-strong":"rgba(14,20,38,0.22)",
      "--accent":      "#1F3FAA",
      "--accent-soft": "#DAE0F4",
      "--accent-hover":"#162E80",
      "--accent-on":   "#FBF8EE",
      "--shadow":      "0 1px 3px rgba(14,20,38,0.06), 0 1px 2px rgba(14,20,38,0.04)",
      "--shadow-pop":  "0 8px 24px rgba(14,20,38,0.10), 0 2px 6px rgba(14,20,38,0.05)",
      "--mark-color":  "#0E1426",
      "--bg-pattern":  "none",
    },
    dark: {
      "--bg-base":     "#0A0E1A",
      "--bg-surface":  "#11162A",
      "--bg-sunk":     "#070A14",
      "--text-primary":"#EAE6D6",
      "--text-secondary":"#9AA1BC",
      "--text-tertiary":"#5B6280",
      "--border-subtle":"rgba(234,230,214,0.06)",
      "--border-default":"rgba(234,230,214,0.10)",
      "--border-strong":"rgba(234,230,214,0.18)",
      "--accent":      "#7390E8",
      "--accent-soft": "rgba(115,144,232,0.16)",
      "--accent-hover":"#9BB0F0",
      "--accent-on":   "#0A0E1A",
      "--shadow":      "0 1px 0 rgba(234,230,214,0.04) inset",
      "--shadow-pop":  "0 8px 28px rgba(0,0,0,0.5)",
      "--mark-color":  "#EAE6D6",
      "--bg-pattern":  "none",
    },
  },

  press: {
    name: "II · Press",
    story: "Penguin paperback red on newsprint cream.",
    light: {
      "--bg-base":     "#F2EBDC",   // newsprint cream, slightly tan
      "--bg-surface":  "#F8F2E2",
      "--bg-sunk":     "#E8DFC8",
      "--text-primary":"#0E0A06",   // true printers ink
      "--text-secondary":"#3D352B",
      "--text-tertiary":"#7A6F5F",
      "--border-subtle":"rgba(14,10,6,0.10)",
      "--border-default":"rgba(14,10,6,0.18)",
      "--border-strong":"rgba(14,10,6,0.32)",
      "--accent":      "#C82B1F",
      "--accent-soft": "#F4DCD8",
      "--accent-hover":"#A2241A",
      "--accent-on":   "#F8F2E2",
      "--shadow":      "0 1px 0 rgba(14,10,6,0.08)",
      "--shadow-pop":  "0 4px 0 rgba(14,10,6,0.10), 0 12px 24px rgba(14,10,6,0.10)",
      "--mark-color":  "#0E0A06",
      "--bg-pattern":  "none",
    },
    dark: {
      "--bg-base":     "#161412",   // ink black, warm
      "--bg-surface":  "#1F1C18",
      "--bg-sunk":     "#0E0C0A",
      "--text-primary":"#F2EBDC",
      "--text-secondary":"#A89D89",
      "--text-tertiary":"#6B6353",
      "--border-subtle":"rgba(242,235,220,0.08)",
      "--border-default":"rgba(242,235,220,0.14)",
      "--border-strong":"rgba(242,235,220,0.24)",
      "--accent":      "#E55444",
      "--accent-soft": "rgba(229,84,68,0.16)",
      "--accent-hover":"#FF6B58",
      "--accent-on":   "#161412",
      "--shadow":      "0 1px 0 rgba(242,235,220,0.04) inset",
      "--shadow-pop":  "0 8px 28px rgba(0,0,0,0.6)",
      "--mark-color":  "#F2EBDC",
      "--bg-pattern":  "none",
    },
  },

  notebook: {
    name: "III · Notebook",
    story: "Engineer's working notebook. Graph paper. Graphite blue.",
    light: {
      "--bg-base":     "#FBFAF5",
      "--bg-surface":  "#FFFFFF",
      "--bg-sunk":     "#F1EFE6",
      "--text-primary":"#1B1F26",   // graphite
      "--text-secondary":"#4D5460",
      "--text-tertiary":"#7E8694",
      "--border-subtle":"rgba(27,31,38,0.08)",
      "--border-default":"rgba(27,31,38,0.14)",
      "--border-strong":"rgba(27,31,38,0.24)",
      "--accent":      "#3A5070",
      "--accent-soft": "#DBE2EC",
      "--accent-hover":"#2A3B58",
      "--accent-on":   "#FFFFFF",
      "--shadow":      "0 1px 2px rgba(27,31,38,0.06)",
      "--shadow-pop":  "0 8px 24px rgba(27,31,38,0.10), 0 2px 6px rgba(27,31,38,0.05)",
      "--mark-color":  "#1B1F26",
      "--bg-pattern":  "linear-gradient(rgba(58,80,112,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(58,80,112,0.05) 1px, transparent 1px)",
      "--bg-pattern-size":"32px 32px",
    },
    dark: {
      "--bg-base":     "#161A21",
      "--bg-surface":  "#1F242E",
      "--bg-sunk":     "#0F1218",
      "--text-primary":"#E5E7EC",
      "--text-secondary":"#9298A6",
      "--text-tertiary":"#5C6271",
      "--border-subtle":"rgba(229,231,236,0.08)",
      "--border-default":"rgba(229,231,236,0.14)",
      "--border-strong":"rgba(229,231,236,0.24)",
      "--accent":      "#7B95C0",
      "--accent-soft": "rgba(123,149,192,0.18)",
      "--accent-hover":"#9CB1D6",
      "--accent-on":   "#161A21",
      "--shadow":      "0 1px 0 rgba(229,231,236,0.04) inset",
      "--shadow-pop":  "0 8px 28px rgba(0,0,0,0.5)",
      "--mark-color":  "#E5E7EC",
      "--bg-pattern":  "linear-gradient(rgba(229,231,236,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(229,231,236,0.04) 1px, transparent 1px)",
      "--bg-pattern-size":"32px 32px",
    },
  },

  sodium: {
    name: "IV · Sodium",
    story: "Sodium-vapor street lamp at night. Industrial yellow.",
    light: {
      "--bg-base":     "#F2EFE7",
      "--bg-surface":  "#FAF7EE",
      "--bg-sunk":     "#E5E2D8",
      "--text-primary":"#181815",
      "--text-secondary":"#48463E",
      "--text-tertiary":"#86837A",
      "--border-subtle":"rgba(24,24,21,0.08)",
      "--border-default":"rgba(24,24,21,0.14)",
      "--border-strong":"rgba(24,24,21,0.24)",
      "--accent":      "#E8B433",
      "--accent-soft": "#F7E9BC",
      "--accent-hover":"#C49621",
      "--accent-on":   "#181815",
      "--shadow":      "0 1px 2px rgba(24,24,21,0.07)",
      "--shadow-pop":  "0 8px 24px rgba(24,24,21,0.10), 0 2px 6px rgba(24,24,21,0.05)",
      "--mark-color":  "#181815",
      "--bg-pattern":  "none",
    },
    dark: {
      "--bg-base":     "#181816",
      "--bg-surface":  "#22221E",
      "--bg-sunk":     "#0E0E0C",
      "--text-primary":"#ECEAE0",
      "--text-secondary":"#A09D90",
      "--text-tertiary":"#5E5C53",
      "--border-subtle":"rgba(236,234,224,0.06)",
      "--border-default":"rgba(236,234,224,0.10)",
      "--border-strong":"rgba(236,234,224,0.18)",
      "--accent":      "#FFD256",
      "--accent-soft": "rgba(255,210,86,0.16)",
      "--accent-hover":"#FFE07A",
      "--accent-on":   "#181816",
      "--shadow":      "0 1px 0 rgba(236,234,224,0.04) inset",
      "--shadow-pop":  "0 8px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(236,234,224,0.06)",
      "--mark-color":  "#ECEAE0",
      "--bg-pattern":  "none",
    },
  },
};

window.applyPalette = function (paletteKey, mode) {
  const palette = window.PERCY_PALETTES[paletteKey];
  if (!palette) return;
  const tokens = palette[mode] || palette.light;
  const root = document.documentElement;
  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v));
  root.dataset.palette = paletteKey;
  root.dataset.mode = mode;
};
