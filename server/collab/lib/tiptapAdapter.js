/**
 * Server-side mirror of frontend/src/lib/bridge/tiptapAdapter.ts.
 *
 * Pure JS so the collab server can convert Y.XmlFragment → Bridge JSON
 * without dragging in TypeScript tooling. Logic is identical to the
 * frontend adapter — change them together.
 */

// ── Bridge → Tiptap (only used for hydration; less critical here) ────────────

export function paragraphsToTiptap(content) {
  return {
    type: "doc",
    content: (content?.paragraphs?.length ?? 0) === 0
      ? [{ type: "paragraph" }]
      : content.paragraphs.map(paragraphToTiptap),
  }
}

function paragraphToTiptap(p) {
  const attrs = {}
  if (p.alignment)              attrs.textAlign   = p.alignment
  if (p.space_before != null)   attrs.spaceBefore = p.space_before
  if (p.space_after  != null)   attrs.spaceAfter  = p.space_after

  const inline = []
  for (const run of p.runs ?? []) {
    if (run.is_line_break) inline.push({ type: "hardBreak" })
    else if (run.text)     inline.push(runToText(run))
  }
  return {
    type: "paragraph",
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(inline.length > 0 ? { content: inline } : {}),
  }
}

function runToText(run) {
  const marks = []
  if (run.font_bold)      marks.push({ type: "bold" })
  if (run.font_italic)    marks.push({ type: "italic" })
  if (run.font_underline) marks.push({ type: "underline" })
  if (run.strikethrough)  marks.push({ type: "strike" })
  const sa = {}
  if (run.font_name)            sa.fontName  = run.font_name
  if (run.font_size != null)    sa.fontSize  = run.font_size
  if (run.font_color)           sa.fontColor = run.font_color
  if (run.font_caps)            sa.caps      = run.font_caps
  if (Object.keys(sa).length > 0) marks.push({ type: "textStyle", attrs: sa })
  return {
    type: "text",
    text: run.text,
    ...(marks.length > 0 ? { marks } : {}),
  }
}

// ── Tiptap → Bridge ──────────────────────────────────────────────────────────

export function tiptapToParagraphs(json) {
  const blocks = (json?.content ?? []).filter((c) => c.type === "paragraph")
  if (blocks.length === 0) {
    return { kind: "paragraphs", paragraphs: [emptyParagraph(0)] }
  }
  return {
    kind: "paragraphs",
    paragraphs: blocks.map((b, i) => paragraphFromTiptap(b, i)),
  }
}

function paragraphFromTiptap(node, idx) {
  const attrs = node.attrs ?? {}
  const runs = []
  let runIdx = 0
  for (const child of node.content ?? []) {
    if (child.type === "hardBreak") {
      runs.push(makeRun(runIdx++, "", true))
      continue
    }
    if (child.type === "text" && child.text) {
      runs.push(textNodeToRun(child, runIdx++))
    }
  }
  // Merge consecutive same-format runs
  const merged = []
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
    alignment:    typeof attrs.textAlign   === "string" ? attrs.textAlign   : null,
    space_before: typeof attrs.spaceBefore === "number" ? attrs.spaceBefore : null,
    space_after:  typeof attrs.spaceAfter  === "number" ? attrs.spaceAfter  : null,
    runs: merged.length > 0 ? merged : [makeRun(0, "")],
  }
}

function textNodeToRun(node, idx) {
  const marks = node.marks ?? []
  const has = (t) => marks.some((m) => m.type === t)
  const styleMark = marks.find((m) => m.type === "textStyle")
  const sa = styleMark?.attrs ?? {}
  return {
    idx,
    text: node.text ?? "",
    is_line_break: false,
    font_name:      typeof sa.fontName  === "string" ? sa.fontName  : null,
    font_size:      typeof sa.fontSize  === "number" ? sa.fontSize  : null,
    font_color:     typeof sa.fontColor === "string" ? sa.fontColor : null,
    font_caps:      typeof sa.caps      === "string" ? sa.caps      : null,
    font_bold:      has("bold")      ? true : null,
    font_italic:    has("italic")    ? true : null,
    font_underline: has("underline") ? true : null,
    strikethrough:  has("strike")    ? "sng" : null,
  }
}

function sameFormat(a, b) {
  return a.font_name      === b.font_name
      && a.font_size      === b.font_size
      && a.font_color     === b.font_color
      && a.font_caps      === b.font_caps
      && !!a.font_bold    === !!b.font_bold
      && !!a.font_italic  === !!b.font_italic
      && !!a.font_underline === !!b.font_underline
      && a.strikethrough  === b.strikethrough
}

function emptyParagraph(idx) {
  return {
    idx, alignment: null, space_before: null, space_after: null,
    runs: [makeRun(0, "")],
  }
}

function makeRun(idx, text, isBreak = false) {
  return {
    idx, text, is_line_break: isBreak,
    font_name: null, font_size: null,
    font_bold: null, font_italic: null, font_underline: null,
    font_color: null, strikethrough: null, font_caps: null,
  }
}
