import type { JSONContent } from "@tiptap/core"
import type {
  ParagraphsTextContent, ParagraphData, RunData,
} from "../studioTypes"

/**
 * Bridge ↔ Tiptap (ProseMirror JSON) adapter.
 *
 * Mapping summary:
 *
 *     ParagraphData       → ProseMirror "paragraph" node
 *       alignment           paragraph attrs.textAlign
 *       space_before        paragraph attrs.spaceBefore
 *       space_after         paragraph attrs.spaceAfter
 *       line_spacing        paragraph attrs.lineSpacing
 *       bullet_type         paragraph attrs.bulletType
 *       bullet_char         paragraph attrs.bulletChar
 *
 *     RunData             → ProseMirror "text" node + marks
 *       text                node.text
 *       is_line_break       "hardBreak" node (no text)
 *       font_bold           "bold" mark
 *       font_italic         "italic" mark
 *       font_underline      "underline" mark
 *       strikethrough       "strike" mark
 *       font_name           "textStyle" mark attrs.fontName
 *       font_size           "textStyle" mark attrs.fontSize
 *       font_color          "textStyle" mark attrs.fontColor
 *       font_caps           "textStyle" mark attrs.caps
 *       baseline_shift      "textStyle" mark attrs.baselineShift
 *       char_spacing        "textStyle" mark attrs.charSpacing
 */

// ── Bridge → Tiptap ──────────────────────────────────────────────────────────

export function paragraphsToTiptap(content: ParagraphsTextContent): JSONContent {
  return {
    type: "doc",
    content: content.paragraphs.length === 0
      ? [emptyParagraph()]
      : content.paragraphs.map(paragraphToTiptap),
  }
}

function paragraphToTiptap(p: ParagraphData): JSONContent {
  const attrs: Record<string, unknown> = {}
  if (p.alignment)    attrs.textAlign   = p.alignment
  if (p.space_before != null) attrs.spaceBefore = p.space_before
  if (p.space_after  != null) attrs.spaceAfter  = p.space_after
  if (p.line_spacing != null) attrs.lineSpacing  = p.line_spacing
  if (p.bullet_type && p.bullet_type !== "none") attrs.bulletType = p.bullet_type
  if (p.bullet_char) attrs.bulletChar = p.bullet_char

  const inline: JSONContent[] = []
  for (const run of p.runs) {
    if (run.is_line_break) {
      inline.push({ type: "hardBreak" })
    } else if (run.text) {
      inline.push(runToTiptapText(run))
    }
  }

  return {
    type: "paragraph",
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(inline.length > 0 ? { content: inline } : {}),
  }
}

function runToTiptapText(run: RunData): JSONContent {
  const marks: { type: string; attrs?: Record<string, unknown> }[] = []
  if (run.font_bold)      marks.push({ type: "bold" })
  if (run.font_italic)    marks.push({ type: "italic" })
  if (run.font_underline) marks.push({ type: "underline" })
  if (run.strikethrough && run.strikethrough !== "noStrike")  marks.push({ type: "strike" })

  const styleAttrs: Record<string, unknown> = {}
  if (run.font_name)  styleAttrs.fontName  = run.font_name
  if (run.font_size != null) styleAttrs.fontSize = run.font_size
  if (run.font_color) styleAttrs.fontColor = run.font_color
  if (run.font_caps)  styleAttrs.caps      = run.font_caps
  if (run.baseline_shift != null) styleAttrs.baselineShift = run.baseline_shift
  if (run.char_spacing   != null) styleAttrs.charSpacing   = run.char_spacing
  if (Object.keys(styleAttrs).length > 0) {
    marks.push({ type: "textStyle", attrs: styleAttrs })
  }

  return {
    type: "text",
    text: run.text,
    ...(marks.length > 0 ? { marks } : {}),
  }
}

function emptyParagraph(): JSONContent {
  return { type: "paragraph" }
}

// ── Tiptap → Bridge ──────────────────────────────────────────────────────────

export function tiptapToParagraphs(json: JSONContent): ParagraphsTextContent {
  const blocks = (json.content ?? []).filter((c) => c.type === "paragraph")
  if (blocks.length === 0) {
    return {
      kind: "paragraphs",
      paragraphs: [emptyBridgeParagraph(0)],
    }
  }
  return {
    kind: "paragraphs",
    paragraphs: blocks.map((b, i) => paragraphFromTiptap(b, i)),
  }
}

function paragraphFromTiptap(node: JSONContent, idx: number): ParagraphData {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const runs: RunData[] = []
  let runIdx = 0

  for (const child of node.content ?? []) {
    if (child.type === "hardBreak") {
      runs.push({
        idx: runIdx++,
        text: "",
        is_line_break: true,
        font_name: null, font_size: null,
        font_bold: null, font_italic: null, font_underline: null,
        font_color: null, strikethrough: null, font_caps: null,
        baseline_shift: null, char_spacing: null,
      })
      continue
    }
    if (child.type === "text" && child.text) {
      runs.push(textNodeToRun(child, runIdx++))
    }
  }

  const merged: RunData[] = []
  for (const r of runs) {
    const prev = merged[merged.length - 1]
    if (prev && !prev.is_line_break && !r.is_line_break && sameFormat(prev, r)) {
      prev.text += r.text
    } else {
      merged.push(r)
    }
  }
  merged.forEach((r, i) => { r.idx = i })

  return {
    idx,
    alignment:    typeof attrs.textAlign   === "string" ? attrs.textAlign : null,
    space_before: typeof attrs.spaceBefore === "number" ? attrs.spaceBefore : null,
    space_after:  typeof attrs.spaceAfter  === "number" ? attrs.spaceAfter : null,
    line_spacing: typeof attrs.lineSpacing === "number" ? attrs.lineSpacing : null,
    indent_level: null,
    left_indent:  null,
    bullet_type:  typeof attrs.bulletType === "string" ? attrs.bulletType : null,
    bullet_char:  typeof attrs.bulletChar === "string" ? attrs.bulletChar : null,
    runs: merged.length > 0 ? merged : [emptyRun(0)],
  }
}

function textNodeToRun(node: JSONContent, idx: number): RunData {
  const marks = (node.marks ?? []) as { type: string; attrs?: Record<string, unknown> }[]
  const has = (t: string) => marks.some((m) => m.type === t)
  const styleMark = marks.find((m) => m.type === "textStyle")
  const sa = (styleMark?.attrs ?? {}) as Record<string, unknown>

  return {
    idx,
    text: node.text ?? "",
    is_line_break: false,
    font_name:      typeof sa.fontName  === "string" ? sa.fontName  : null,
    font_size:      typeof sa.fontSize  === "number" ? sa.fontSize  : null,
    font_color:     typeof sa.fontColor === "string" ? sa.fontColor : null,
    font_caps:      typeof sa.caps      === "string" ? sa.caps      : null,
    baseline_shift: typeof sa.baselineShift === "number" ? sa.baselineShift : null,
    char_spacing:   typeof sa.charSpacing   === "number" ? sa.charSpacing   : null,
    font_bold:      has("bold")      ? true : null,
    font_italic:    has("italic")    ? true : null,
    font_underline: has("underline") ? true : null,
    strikethrough:  has("strike")    ? "sng" : null,
  }
}

function sameFormat(a: RunData, b: RunData): boolean {
  return a.font_name      === b.font_name
      && a.font_size      === b.font_size
      && a.font_color     === b.font_color
      && a.font_caps      === b.font_caps
      && a.baseline_shift === b.baseline_shift
      && a.char_spacing   === b.char_spacing
      && !!a.font_bold    === !!b.font_bold
      && !!a.font_italic  === !!b.font_italic
      && !!a.font_underline === !!b.font_underline
      && a.strikethrough  === b.strikethrough
}

function emptyBridgeParagraph(idx: number): ParagraphData {
  return {
    idx, alignment: null, space_before: null, space_after: null,
    line_spacing: null, indent_level: null, left_indent: null,
    bullet_type: null, bullet_char: null,
    runs: [emptyRun(0)],
  }
}

function emptyRun(idx: number): RunData {
  return {
    idx, text: "", is_line_break: false,
    font_name: null, font_size: null,
    font_bold: null, font_italic: null, font_underline: null,
    font_color: null, strikethrough: null, font_caps: null,
    baseline_shift: null, char_spacing: null,
  }
}
