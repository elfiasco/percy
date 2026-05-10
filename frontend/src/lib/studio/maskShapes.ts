// ── Crop-to-shape mask paths ─────────────────────────────────────────────────
// Each mask is defined as an SVG path/clip on a 100×100 viewBox so it scales
// with the image dimensions. Categories mirror Google Slides "Mask image" gallery.

export type MaskCategory = "shapes" | "arrows" | "callouts" | "equation"
export interface MaskDef {
  value: string                  // unique key
  label: string                  // human-readable
  category: MaskCategory
  /** SVG content (path/circle/rect/polygon) on a 100×100 viewBox. */
  svg: string
}

/** All available masks (~40 — enough for a strong gallery without bloat). */
export const MASKS: MaskDef[] = [
  // ── Basic shapes ─────────────────────────────────────────────────────────
  { value: "rectangle",      label: "Rectangle",        category: "shapes",
    svg: `<rect width="100" height="100" />` },
  { value: "rounded_rect",   label: "Rounded rectangle", category: "shapes",
    svg: `<rect width="100" height="100" rx="12" ry="12" />` },
  { value: "circle",         label: "Circle",           category: "shapes",
    svg: `<circle cx="50" cy="50" r="50" />` },
  { value: "ellipse",        label: "Ellipse",          category: "shapes",
    svg: `<ellipse cx="50" cy="50" rx="50" ry="35" />` },
  { value: "triangle",       label: "Triangle",         category: "shapes",
    svg: `<polygon points="50,0 100,100 0,100" />` },
  { value: "rtriangle",      label: "Right triangle",   category: "shapes",
    svg: `<polygon points="0,0 100,100 0,100" />` },
  { value: "diamond",        label: "Diamond",          category: "shapes",
    svg: `<polygon points="50,0 100,50 50,100 0,50" />` },
  { value: "pentagon",       label: "Pentagon",         category: "shapes",
    svg: `<polygon points="50,0 100,38 81,100 19,100 0,38" />` },
  { value: "hexagon",        label: "Hexagon",          category: "shapes",
    svg: `<polygon points="25,0 75,0 100,50 75,100 25,100 0,50" />` },
  { value: "octagon",        label: "Octagon",          category: "shapes",
    svg: `<polygon points="30,0 70,0 100,30 100,70 70,100 30,100 0,70 0,30" />` },
  { value: "parallelogram",  label: "Parallelogram",    category: "shapes",
    svg: `<polygon points="20,0 100,0 80,100 0,100" />` },
  { value: "trapezoid",      label: "Trapezoid",        category: "shapes",
    svg: `<polygon points="20,0 80,0 100,100 0,100" />` },
  { value: "star5",          label: "5-point star",     category: "shapes",
    svg: `<polygon points="50,0 61,38 100,38 69,61 81,100 50,76 19,100 31,61 0,38 39,38" />` },
  { value: "star8",          label: "8-point star",     category: "shapes",
    svg: `<polygon points="50,0 60,30 90,15 75,40 100,50 75,60 90,85 60,70 50,100 40,70 10,85 25,60 0,50 25,40 10,15 40,30" />` },
  { value: "heart",          label: "Heart",            category: "shapes",
    svg: `<path d="M50,90 C25,65 0,45 0,25 C0,5 20,0 35,15 C42,22 50,30 50,30 C50,30 58,22 65,15 C80,0 100,5 100,25 C100,45 75,65 50,90 Z" />` },
  { value: "cloud",          label: "Cloud",            category: "shapes",
    svg: `<path d="M25,80 C10,80 0,70 0,55 C0,40 12,30 25,30 C28,15 42,5 58,15 C70,8 88,15 88,32 C100,35 100,65 85,75 C80,82 70,82 65,80 C55,90 35,90 25,80 Z" />` },
  { value: "moon",           label: "Moon",             category: "shapes",
    svg: `<path d="M65,15 C40,15 20,35 20,55 C20,75 35,90 60,90 C45,80 35,65 35,50 C35,35 45,20 65,15 Z" />` },

  // ── Arrows ──────────────────────────────────────────────────────────────
  { value: "arrow_right",    label: "Right arrow",      category: "arrows",
    svg: `<polygon points="0,30 60,30 60,10 100,50 60,90 60,70 0,70" />` },
  { value: "arrow_left",     label: "Left arrow",       category: "arrows",
    svg: `<polygon points="100,30 40,30 40,10 0,50 40,90 40,70 100,70" />` },
  { value: "arrow_up",       label: "Up arrow",         category: "arrows",
    svg: `<polygon points="30,100 30,40 10,40 50,0 90,40 70,40 70,100" />` },
  { value: "arrow_down",     label: "Down arrow",       category: "arrows",
    svg: `<polygon points="30,0 30,60 10,60 50,100 90,60 70,60 70,0" />` },
  { value: "arrow_lr",       label: "Left-right arrow", category: "arrows",
    svg: `<polygon points="0,50 20,30 20,40 80,40 80,30 100,50 80,70 80,60 20,60 20,70" />` },
  { value: "chevron",        label: "Chevron",          category: "arrows",
    svg: `<polygon points="0,20 60,20 100,50 60,80 0,80 40,50" />` },

  // ── Callouts ────────────────────────────────────────────────────────────
  { value: "callout_round",  label: "Speech (round)",   category: "callouts",
    svg: `<path d="M10,5 L90,5 Q100,5 100,15 L100,65 Q100,75 90,75 L40,75 L20,95 L25,75 L10,75 Q0,75 0,65 L0,15 Q0,5 10,5 Z" />` },
  { value: "callout_rect",   label: "Speech (square)",  category: "callouts",
    svg: `<polygon points="0,5 100,5 100,75 40,75 25,95 30,75 0,75" />` },
  { value: "thought_cloud",  label: "Thought cloud",    category: "callouts",
    svg: `<path d="M20,30 C5,30 0,40 5,50 C-5,55 0,70 12,68 C8,82 30,80 32,72 C40,82 60,80 65,72 C80,82 95,68 90,55 C100,48 95,30 80,32 C78,18 60,15 55,25 C48,12 30,15 28,28 C25,25 22,28 20,30 Z" />` },

  // ── Equation ────────────────────────────────────────────────────────────
  { value: "math_plus",      label: "Plus",             category: "equation",
    svg: `<polygon points="40,0 60,0 60,40 100,40 100,60 60,60 60,100 40,100 40,60 0,60 0,40 40,40" />` },
  { value: "math_minus",     label: "Minus",            category: "equation",
    svg: `<rect x="0" y="40" width="100" height="20" />` },
  { value: "math_multiply",  label: "Multiply",         category: "equation",
    svg: `<polygon points="14,0 50,36 86,0 100,14 64,50 100,86 86,100 50,64 14,100 0,86 36,50 0,14" />` },
  { value: "math_divide",    label: "Divide",           category: "equation",
    svg: `<g><circle cx="50" cy="20" r="8" /><rect x="10" y="42" width="80" height="16" /><circle cx="50" cy="80" r="8" /></g>` },
  { value: "math_equal",     label: "Equal",            category: "equation",
    svg: `<g><rect x="10" y="30" width="80" height="14" /><rect x="10" y="56" width="80" height="14" /></g>` },
]

export function getMask(value: string | null | undefined): MaskDef | null {
  if (!value || value === "rectangle") return null
  return MASKS.find((m) => m.value === value) ?? null
}
