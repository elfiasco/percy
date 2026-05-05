import type { ParagraphsTextContent, ParagraphData, RunData } from "./studioTypes"

/**
 * Convert between Bridge paragraphs/runs and live DOM. The renderer uses this
 * to hydrate a contentEditable, and to serialize back to the typed shape on
 * save. Critical pieces:
 *
 *   - Each paragraph → one block-level <div data-para-idx>
 *   - Each run → one inline <span data-run-idx> with explicit inline styles
 *   - Empty paragraphs render as <div><br></div> so the cursor has a line
 *
 * On the way back we read computed styles from the live DOM so any user
 * formatting applied via execCommand (which inserts <b>/<i>/<u> or wrapping
 * spans) gets folded back into proper RunData fields.
 */

// ── escaping ─────────────────────────────────────────────────────────────────

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c])
}

// ── runs → html ──────────────────────────────────────────────────────────────

export function runStyleString(run: Partial<RunData>): string {
  const s: string[] = []
  if (run.font_name)      s.push(`font-family: ${cssFontFamily(run.font_name)}`)
  if (run.font_size)      s.push(`font-size: ${run.font_size}pt`)
  if (run.font_color)     s.push(`color: ${run.font_color}`)
  if (run.font_bold)      s.push(`font-weight: 700`)
  if (run.font_italic)    s.push(`font-style: italic`)
  // Underline + strikethrough share text-decoration; combine them
  const decos: string[] = []
  if (run.font_underline) decos.push("underline")
  if (run.strikethrough)  decos.push("line-through")
  if (decos.length > 0)   s.push(`text-decoration: ${decos.join(" ")}`)
  if (run.font_caps === "all")    s.push(`text-transform: uppercase`)
  if (run.font_caps === "small")  s.push(`font-variant-caps: small-caps`)
  return s.join("; ")
}

function cssFontFamily(name: string): string {
  // Wrap names with spaces in quotes so they parse correctly
  return /[\s'"]/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name
}

function runToHtml(run: RunData): string {
  const style = runStyleString(run)
  const text  = escapeHtml(run.text || "")
  return `<span data-run-idx="${run.idx}"${style ? ` style="${style}"` : ""}>${text}</span>`
}

function paragraphToHtml(p: ParagraphData): string {
  const align = p.alignment || "left"
  const inner = p.runs.map(runToHtml).join("")
  return `<div data-para-idx="${p.idx}" style="text-align: ${align}; min-height: 1em;">${inner || "<br>"}</div>`
}

export function paragraphsToHtml(content: ParagraphsTextContent): string {
  return content.paragraphs.map(paragraphToHtml).join("")
}

// ── html → paragraphs ────────────────────────────────────────────────────────

interface ResolvedFormat {
  font_name:      string | null
  font_size:      number | null
  font_bold:      boolean | null
  font_italic:    boolean | null
  font_underline: boolean | null
  font_color:     string | null
  strikethrough:  string | null
  font_caps:      string | null
}

function resolveFormat(el: Element): ResolvedFormat {
  const cs = window.getComputedStyle(el)
  // font-family: take the first family, strip quotes
  const fam = cs.fontFamily.split(",")[0]?.replace(/^['"]|['"]$/g, "").trim() || null
  // font-size: px → pt (1pt = 1.3333px)
  const sizePx = parseFloat(cs.fontSize)
  const fontSize = isNaN(sizePx) ? null : Math.round((sizePx / (96 / 72)) * 10) / 10
  const wt = parseInt(cs.fontWeight, 10)
  const bold = !isNaN(wt) ? wt >= 600 : null
  const italic = cs.fontStyle === "italic" || cs.fontStyle === "oblique" ? true : null
  const dec = cs.textDecorationLine || ""
  const underline    = dec.includes("underline")    ? true   : null
  const strikethrough = dec.includes("line-through") ? "sng" : null
  const color = rgbToHex(cs.color)
  const caps = cs.textTransform === "uppercase" ? "all"
             : cs.fontVariantCaps === "small-caps" ? "small"
             : null
  return {
    font_name:      fam,
    font_size:      fontSize,
    font_bold:      bold,
    font_italic:    italic,
    font_underline: underline,
    font_color:     color,
    strikethrough:  strikethrough,
    font_caps:      caps,
  }
}

function rgbToHex(rgb: string): string | null {
  // "rgb(34, 56, 78)" or "rgba(...)"
  const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return null
  const [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()
}

function formatsEqual(a: ResolvedFormat, b: ResolvedFormat): boolean {
  return a.font_name      === b.font_name
      && a.font_size      === b.font_size
      && a.font_bold      === b.font_bold
      && a.font_italic    === b.font_italic
      && a.font_underline === b.font_underline
      && a.font_color     === b.font_color
      && a.strikethrough  === b.strikethrough
      && a.font_caps      === b.font_caps
}

interface RunDraft {
  text: string
  fmt:  ResolvedFormat
  br:   boolean
}

/** Walk a paragraph block, emitting consecutive text+format chunks. */
function collectRuns(block: Element): RunDraft[] {
  const drafts: RunDraft[] = []
  const append = (text: string, fmt: ResolvedFormat) => {
    if (!text) return
    const last = drafts[drafts.length - 1]
    if (last && !last.br && formatsEqual(last.fmt, fmt)) {
      last.text += text
    } else {
      drafts.push({ text, fmt, br: false })
    }
  }

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ""
      const parent = node.parentElement
      if (parent && text) append(text, resolveFormat(parent))
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      // <br> inside a paragraph turns into a soft break; preserve as line break run
      if (el.tagName === "BR") {
        const parent = el.parentElement
        if (parent) {
          drafts.push({ text: "", fmt: resolveFormat(parent), br: true })
        }
        return
      }
      for (const child of Array.from(el.childNodes)) walk(child)
    }
  }
  for (const child of Array.from(block.childNodes)) walk(child)
  return drafts
}

/** Serialize a contentEditable's DOM to typed paragraphs/runs. */
export function paragraphsFromEditableElement(root: HTMLElement): ParagraphsTextContent {
  // Top-level blocks should be <div>s (one per paragraph). If the contentEditable
  // is empty, treat it as one empty paragraph. If for some reason content is
  // wrapped without divs (e.g., just text + <br>s), bucket it into a single para.
  const blocks: Element[] = []
  const topChildren = Array.from(root.children)
  if (topChildren.length === 0) {
    blocks.push(root)
  } else {
    // If the top-level mixes block-level and inline, fall back to splitting on <br>
    const allBlocks = topChildren.every((c) => /^(DIV|P|BLOCKQUOTE|H[1-6])$/.test(c.tagName))
    if (allBlocks) {
      blocks.push(...topChildren)
    } else {
      blocks.push(root)
    }
  }

  const paragraphs: ParagraphData[] = []
  blocks.forEach((block, pIdx) => {
    const cs = window.getComputedStyle(block as HTMLElement)
    const align = (() => {
      const a = cs.textAlign
      if (a === "left" || a === "center" || a === "right" || a === "justify") return a
      // Some browsers report start/end
      if (a === "start") return "left"
      if (a === "end")   return "right"
      return null
    })()

    const drafts = collectRuns(block)
    const runs: RunData[] = drafts.length > 0
      ? drafts.map((d, i) => ({
          idx: i,
          text: d.br ? "" : d.text,
          is_line_break: d.br,
          font_name:      d.fmt.font_name,
          font_size:      d.fmt.font_size,
          font_bold:      d.fmt.font_bold,
          font_italic:    d.fmt.font_italic,
          font_underline: d.fmt.font_underline,
          font_color:     d.fmt.font_color,
          strikethrough:  d.fmt.strikethrough,
          font_caps:      d.fmt.font_caps,
        }))
      : [{
          idx: 0, text: "", is_line_break: false,
          font_name: null, font_size: null,
          font_bold: null, font_italic: null, font_underline: null,
          font_color: null, strikethrough: null, font_caps: null,
        }]

    paragraphs.push({
      idx: pIdx,
      alignment: align,
      space_before: null,
      space_after: null,
      runs,
    })
  })

  return { kind: "paragraphs", paragraphs }
}
