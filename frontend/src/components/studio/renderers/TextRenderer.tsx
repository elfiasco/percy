import { useEffect, useRef, useState, useCallback } from "react"
import type { ParagraphsTextContent } from "../../../lib/studioTypes"
import { fetchElementText, updateElementText, fetchElementStyle } from "../../../lib/studioApi"
import { paragraphsToHtml, paragraphsFromEditableElement } from "../../../lib/textHtml"
import { registerActiveEditor, notifySelectionChange } from "../../../lib/textEditingBus"
import type { TextFormat, ParagraphFormat } from "../../../lib/textFormat"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"

/**
 * TextRenderer — replaces the rasterized PNG fallback for text-bearing
 * elements with native DOM. Click while the element is selected to enter
 * edit mode; type, delete, paste freely. Selection-level formatting is
 * driven by the ribbon (via the textEditingBus) and by native browser
 * shortcuts (Ctrl+B/I/U) inside the contentEditable.
 *
 * Save: on blur, the live DOM is serialized back to the typed paragraphs/
 * runs structure that the rest of Percy already understands.
 */

interface ElementStyleLite {
  fill_color?:      string | null
  fill_type?:       string | null
  line_color?:      string | null
  line_width?:      number | null
  opacity?:         number | null
}

function TextRendererImpl({ element, docId, slideN, renderKey, selected }: NativeRendererProps) {
  const [content, setContent] = useState<ParagraphsTextContent | null>(null)
  const [style, setStyle]     = useState<ElementStyleLite | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // ── load text + style ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([
      fetchElementText(docId, slideN, element.id).then((c) => c.kind === "paragraphs" ? c : null).catch(() => null),
      fetchElementStyle(docId, slideN, element.id).catch(() => null),
    ]).then(([textC, styleC]) => {
      if (cancelled) return
      setContent(textC ?? { kind: "paragraphs", paragraphs: [{ idx: 0, alignment: null, space_before: null, space_after: null, runs: [] }] })
      setStyle(styleC ?? null)
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [docId, slideN, element.id, renderKey])

  // Exit edit mode if the element gets unselected
  useEffect(() => { if (!selected && editing) setEditing(false) }, [selected, editing])

  if (error) {
    return <div style={ERR_STYLE}>! text load failed</div>
  }
  if (!content) {
    return <div style={{ width: "100%", height: "100%" }} />
  }

  const containerStyle: React.CSSProperties = {
    width:          "100%",
    height:         "100%",
    boxSizing:      "border-box",
    background:     style?.fill_color ?? "transparent",
    border:         style?.line_color ? `${style.line_width ?? 1}px solid ${style.line_color}` : undefined,
    opacity:        style?.opacity ?? 1,
    padding:        "0.12em 0.18em",
    overflow:       "hidden",
    display:        "flex",
    flexDirection:  "column",
    justifyContent: "flex-start",   // PowerPoint defaults to top-aligned text
  }

  if (editing) {
    return (
      <RichTextEditor
        elementId={element.id}
        docId={docId}
        slideN={slideN}
        initialContent={content}
        containerStyle={containerStyle}
        onSave={(newContent) => {
          setContent(newContent)
          setEditing(false)
        }}
        onExit={() => setEditing(false)}
      />
    )
  }

  return (
    <div
      style={containerStyle}
      // Click while selected = enter edit mode. The first click selects the element
      // (handled by the parent), so we use an onMouseDown that bails on the very
      // first click and arms a second-click → edit transition.
      onClick={(e) => {
        if (!selected) return            // first click selects; let parent handle
        e.stopPropagation()
        setEditing(true)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      dangerouslySetInnerHTML={{ __html: paragraphsToHtml(content) }}
    />
  )
}

const ERR_STYLE: React.CSSProperties = {
  width: "100%", height: "100%",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "#fff5f5", color: "#b91c1c", fontSize: 9, fontFamily: "monospace",
}

// ── editor ──────────────────────────────────────────────────────────────────

function RichTextEditor({
  elementId, docId, slideN, initialContent, containerStyle,
  onSave, onExit,
}: {
  elementId:       string
  docId:           string
  slideN:          number
  initialContent:  ParagraphsTextContent
  containerStyle:  React.CSSProperties
  onSave:          (c: ParagraphsTextContent) => void
  onExit:          () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const lastSavedJSON = useRef<string>("")

  // Hydrate + focus on mount
  useEffect(() => {
    const div = ref.current
    if (!div) return
    div.innerHTML = paragraphsToHtml(initialContent)
    lastSavedJSON.current = JSON.stringify(initialContent)
    // Place caret at end
    const range = document.createRange()
    range.selectNodeContents(div)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    div.focus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useCallback(async () => {
    const div = ref.current
    if (!div) return
    const next = paragraphsFromEditableElement(div)
    const nextJSON = JSON.stringify(next)
    if (nextJSON === lastSavedJSON.current) {
      onExit()
      return
    }
    try {
      const updated = await updateElementText(docId, slideN, elementId, next)
      if (updated.kind === "paragraphs") {
        lastSavedJSON.current = JSON.stringify(updated)
        onSave(updated)
      } else {
        onExit()
      }
    } catch (e) {
      console.error("text save failed:", e)
      onExit()
    }
  }, [docId, slideN, elementId, onSave, onExit])

  // Apply formatting from the ribbon to the current selection
  const applySelection = useCallback((text: TextFormat, para?: ParagraphFormat) => {
    const div = ref.current
    if (!div) return
    div.focus()

    // Ensure modifications are wrapped in spans rather than legacy <font>/<b> tags
    document.execCommand("styleWithCSS", false, "true")

    if (text.font_bold      !== undefined) document.execCommand("bold")
    if (text.font_italic    !== undefined) document.execCommand("italic")
    if (text.font_underline !== undefined) document.execCommand("underline")
    if (text.strikethrough  !== undefined) document.execCommand("strikeThrough")
    if (text.font_color     !== undefined && text.font_color)  document.execCommand("foreColor", false, text.font_color)
    if (text.font_color === null) document.execCommand("foreColor", false, "inherit")
    if (text.font_name      !== undefined && text.font_name)   document.execCommand("fontName",  false, text.font_name)
    if (text.font_size      !== undefined && text.font_size != null) wrapSelectionStyle(`font-size: ${text.font_size}pt`)
    if (text.font_caps      !== undefined) {
      const v = text.font_caps === "all"  ? "uppercase"
              : text.font_caps === "small" ? "small-caps"  // applies via font-variant-caps below
              : "none"
      const prop = text.font_caps === "small" ? "font-variant-caps" : "text-transform"
      wrapSelectionStyle(`${prop}: ${v}`)
    }

    if (para?.alignment !== undefined && para.alignment) {
      const cmd = para.alignment === "center"  ? "justifyCenter"
                : para.alignment === "right"   ? "justifyRight"
                : para.alignment === "justify" ? "justifyFull"
                : "justifyLeft"
      document.execCommand(cmd)
    }
  }, [])

  // Read the current selection's format by sampling its anchor element's computed style
  const readSelectionFormat = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    let node: Node | null = range.startContainer
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement
    if (!node || !(node as HTMLElement).getBoundingClientRect) return null
    const editor = ref.current
    if (!editor || !editor.contains(node)) return null
    const cs = window.getComputedStyle(node as HTMLElement)
    const dec = cs.textDecorationLine || ""
    const wt  = parseInt(cs.fontWeight, 10)
    const sizePx = parseFloat(cs.fontSize)
    const sizePt = isNaN(sizePx) ? null : Math.round((sizePx / (96 / 72)) * 10) / 10
    const fam = cs.fontFamily.split(",")[0]?.replace(/^['"]|['"]$/g, "").trim() || null
    return {
      text: {
        font_name:      fam,
        font_size:      sizePt,
        font_bold:      !isNaN(wt) ? wt >= 600 : false,
        font_italic:    cs.fontStyle === "italic" || cs.fontStyle === "oblique",
        font_underline: dec.includes("underline"),
        strikethrough:  dec.includes("line-through") ? "sng" : null,
        font_caps:      cs.textTransform === "uppercase" ? "all"
                      : cs.fontVariantCaps === "small-caps" ? "small"
                      : null,
        font_color:     null,
      } as TextFormat,
      paragraph: {
        alignment: (cs.textAlign === "start" ? "left"
                  : cs.textAlign === "end"   ? "right"
                  : cs.textAlign) as ParagraphFormat["alignment"],
      },
    }
  }, [])

  // Register with the active-editor bus while mounted
  useEffect(() => {
    return registerActiveEditor({
      elementId,
      applySelection,
      readSelectionFormat,
    })
  }, [elementId, applySelection, readSelectionFormat])

  // Notify the bus on selectionchange / keyup / mouseup so the ribbon updates
  useEffect(() => {
    const onSelChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const node = sel.anchorNode
      if (!node || !ref.current?.contains(node)) return
      notifySelectionChange()
    }
    document.addEventListener("selectionchange", onSelChange)
    return () => document.removeEventListener("selectionchange", onSelChange)
  }, [])

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={save}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Escape") {
          e.preventDefault()
          onExit()
          return
        }
        // Save on Ctrl+Enter without losing focus elsewhere
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          save()
          return
        }
        // Native Ctrl+B/I/U work in contentEditable; let them through
      }}
      onPaste={(e) => {
        // Strip rich formatting on paste — keep only plain text. This avoids
        // pasted Word/Google-Docs content polluting our run model with junk.
        e.preventDefault()
        const text = e.clipboardData.getData("text/plain")
        document.execCommand("insertText", false, text)
      }}
      style={{
        ...containerStyle,
        outline:       "2px solid var(--accent, #e8c97a)",
        outlineOffset: "-2px",
        cursor:        "text",
        whiteSpace:    "pre-wrap",
        userSelect:    "text",
      }}
    />
  )
}

// Wrap the current selection in a span with the given inline style
function wrapSelectionStyle(styleStr: string) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  const span  = document.createElement("span")
  span.setAttribute("style", styleStr)
  try {
    span.appendChild(range.extractContents())
    range.insertNode(span)
    // Re-select the inserted span so the user can continue typing within it
    const newRange = document.createRange()
    newRange.selectNodeContents(span)
    sel.removeAllRanges()
    sel.addRange(newRange)
  } catch (e) {
    console.warn("wrapSelectionStyle failed:", e)
  }
}

export function registerTextRenderer(): void {
  registerRenderer("BridgeText",     TextRendererImpl)
  // BridgeShape can hold text too; rendering it natively means we lose the
  // shape geometry (rectangle vs. ellipse vs. arrow). Leave shapes on PNG
  // fallback for now and revisit when shape-text gets a dedicated renderer.
}

export default TextRendererImpl
