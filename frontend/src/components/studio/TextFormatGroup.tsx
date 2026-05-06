import { useState, useEffect, useCallback, useRef } from "react"
import type { StudioElement, ParagraphsTextContent } from "../../lib/studioTypes"
import { fetchElementText, updateElementText } from "../../lib/studioApi"
import {
  applyFormatToAllRuns, applyParagraphFormat, readCurrentFormat,
  COMMON_FONTS, COMMON_SIZES,
  type TextFormat, type ParagraphFormat,
} from "../../lib/textFormat"
import { getActiveTiptapEditor, subscribeActiveEditor } from "../../lib/bridge/activeEditor"

/**
 * TextFormatGroup — the ribbon's text-formatting controls.
 *
 * Two operating modes:
 *
 *   1. **Selection mode** — when a Tiptap editor is active for this element,
 *      every control dispatches a Tiptap command on the live selection.
 *      Toggle indicators (B/I/U) reflect `editor.isActive(...)`. Font / size
 *      / color reflect the textStyle mark on the current selection.
 *
 *   2. **Element mode** — when no editor is active (the user clicked an
 *      element but isn't inside the text yet), apply formatting to every
 *      run in the element via fetchElementText/updateElementText.
 *
 * The mode is determined entirely by `getActiveTiptapEditor()`. The ribbon
 * UI is identical in both modes.
 */

interface Props {
  element:    StudioElement
  docId:      string
  slideN:     number
  onCommit?:  () => void
}

const TEXT_CAPABLE = new Set([
  "BridgeText", "BridgeShape", "BridgeFreeform",
])

export function isTextCapable(el: StudioElement | null): boolean {
  return !!el && TEXT_CAPABLE.has(el.type)
}

export default function TextFormatGroup({ element, docId, slideN, onCommit }: Props) {
  const [content, setContent] = useState<ParagraphsTextContent | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [fontMenu, setFontMenu] = useState(false)
  const [sizeMenu, setSizeMenu] = useState(false)
  const fontRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<HTMLDivElement>(null)

  // Pull element text on mount/element-change for element-mode default state
  useEffect(() => {
    let cancelled = false
    fetchElementText(docId, slideN, element.id)
      .then((c) => {
        if (cancelled) return
        if (c.kind === "paragraphs") setContent(c)
        else                         setContent(null)
      })
      .catch(() => { if (!cancelled) setContent(null) })
    return () => { cancelled = true }
  }, [docId, slideN, element.id])

  // Re-render when active editor changes (selection move, mount, unmount)
  const [, force] = useState(0)
  useEffect(() => subscribeActiveEditor(() => force((v) => v + 1)), [])

  // Close menus on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (fontMenu && fontRef.current && !fontRef.current.contains(e.target as Node)) setFontMenu(false)
      if (sizeMenu && sizeRef.current && !sizeRef.current.contains(e.target as Node)) setSizeMenu(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [fontMenu, sizeMenu])

  // ── derive UI state from whichever mode we're in ────────────────────────
  const active = getActiveTiptapEditor()
  const inSelectionMode = !!active && active.elementId === element.id

  const cur = (() => {
    if (inSelectionMode && active) {
      const e = active.editor
      const ts = e.getAttributes("textStyle")
      const para = e.getAttributes("paragraph")
      return {
        text: {
          font_name:      typeof ts.fontName  === "string" ? ts.fontName  : null,
          font_size:      typeof ts.fontSize  === "number" ? ts.fontSize  : null,
          font_color:     typeof ts.fontColor === "string" ? ts.fontColor : null,
          font_caps:      typeof ts.caps      === "string" ? ts.caps      : null,
          font_bold:      e.isActive("bold"),
          font_italic:    e.isActive("italic"),
          font_underline: e.isActive("underline"),
          strikethrough:  e.isActive("strike") ? "sng" : null,
        } as TextFormat,
        paragraph: {
          alignment: typeof para.textAlign === "string" ? para.textAlign : null,
        } as ParagraphFormat,
      }
    }
    return readCurrentFormat(content)
  })()

  // ── command dispatch ────────────────────────────────────────────────────
  const apply = useCallback(async (
    text: TextFormat = {},
    para: ParagraphFormat = {},
  ) => {
    const ed = getActiveTiptapEditor()
    if (ed && ed.elementId === element.id) {
      // Selection mode — Tiptap commands
      const c = ed.editor.chain().focus()
      if (text.font_bold      !== undefined) c.toggleBold()
      if (text.font_italic    !== undefined) c.toggleItalic()
      if (text.font_underline !== undefined) c.toggleUnderline()
      if (text.strikethrough  !== undefined) c.toggleStrike()
      if (text.font_name      !== undefined && text.font_name)  c.setMark("textStyle", { fontName:  text.font_name })
      if (text.font_size      !== undefined && text.font_size != null) c.setMark("textStyle", { fontSize: text.font_size })
      if (text.font_color     !== undefined) {
        if (text.font_color) c.setMark("textStyle", { fontColor: text.font_color })
        else                 c.unsetMark("textStyle")
      }
      if (text.font_caps      !== undefined) c.setMark("textStyle", { caps: text.font_caps })
      if (para.alignment      !== undefined && para.alignment) c.setTextAlign(para.alignment)
      c.run()
      return
    }

    // Element mode — fetch/mutate/save the whole element's runs
    setBusy(true)
    try {
      const fresh = await fetchElementText(docId, slideN, element.id)
      if (fresh.kind !== "paragraphs") return
      let nextParas = fresh.paragraphs
      if (Object.keys(text).length > 0) nextParas = applyFormatToAllRuns(nextParas, text)
      if (Object.keys(para).length > 0) nextParas = applyParagraphFormat(nextParas, para)
      const updated = await updateElementText(docId, slideN, element.id, {
        kind: "paragraphs",
        paragraphs: nextParas,
      })
      if (updated.kind === "paragraphs") setContent(updated)
      onCommit?.()
    } catch (e) {
      console.error("text format apply failed:", e)
    } finally {
      setBusy(false)
    }
  }, [docId, slideN, element.id, onCommit])

  const fontDisplay = cur.text.font_name || "Mixed"
  const sizeDisplay = cur.text.font_size != null ? String(cur.text.font_size) : "—"
  const align       = cur.paragraph.alignment ?? "left"

  return (
    <div className="flex h-full items-stretch gap-1 px-1 py-1.5">
      {/* Font + alignment row */}
      <div className="flex flex-col gap-1 justify-center" ref={fontRef}>
        <div className="relative">
          <button
            onClick={() => { setFontMenu((o) => !o); setSizeMenu(false) }}
            disabled={busy}
            className="h-6 w-40 px-2 text-[11px] bg-base border border-edge text-paper hover:border-paper/40 flex items-center justify-between gap-1"
            title="Font"
          >
            <span className="truncate" style={{ fontFamily: fontDisplay !== "Mixed" ? fontDisplay : undefined }}>
              {fontDisplay}
            </span>
            <span className="text-muted text-[9px]">▾</span>
          </button>
          {fontMenu && (
            <div className="absolute left-0 top-full mt-1 z-50 w-56 max-h-72 overflow-y-auto bg-surface border border-edge shadow-2xl"
                 style={{ background: "rgb(var(--surface))" }}>
              {COMMON_FONTS.map((f) => (
                <button key={f} onClick={() => { apply({ font_name: f }); setFontMenu(false) }}
                  className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-paper/10 transition-colors ${
                    f === cur.text.font_name ? "bg-paper/5 text-paper" : "text-muted"
                  }`}
                  style={{ fontFamily: f }}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-0.5">
          {(["left", "center", "right", "justify"] as const).map((a) => (
            <button key={a}
              onClick={() => apply({}, { alignment: a })}
              disabled={busy}
              title={`Align ${a}`}
              className={`w-7 h-6 flex items-center justify-center text-[12px] border ${
                align === a
                  ? "bg-paper/10 text-paper border-paper/30"
                  : "border-edge text-muted hover:text-paper hover:bg-paper/5"
              }`}
            >
              {a === "left" ? "⫷" : a === "center" ? "⊟" : a === "right" ? "⫸" : "≣"}
            </button>
          ))}
        </div>
      </div>

      {/* Size + emphasis */}
      <div className="flex flex-col gap-1 justify-center" ref={sizeRef}>
        <div className="flex items-center gap-0.5">
          <button onClick={() => {
            const cur_ = cur.text.font_size ?? 18
            apply({ font_size: Math.max(6, cur_ - 1) })
          }} disabled={busy}
            className="w-5 h-6 flex items-center justify-center text-[12px] text-muted hover:text-paper border border-edge hover:bg-paper/5"
            title="Decrease size"
          >−</button>
          <div className="relative">
            <button
              onClick={() => { setSizeMenu((o) => !o); setFontMenu(false) }}
              disabled={busy}
              className="h-6 w-12 px-1 text-[11px] bg-base border border-edge text-paper hover:border-paper/40 flex items-center justify-between gap-0.5 font-mono"
              title="Font size (pt)"
            >
              <span>{sizeDisplay}</span>
              <span className="text-muted text-[9px]">▾</span>
            </button>
            {sizeMenu && (
              <div className="absolute left-0 top-full mt-1 z-50 w-16 max-h-72 overflow-y-auto bg-surface border border-edge shadow-2xl"
                   style={{ background: "rgb(var(--surface))" }}>
                {COMMON_SIZES.map((s) => (
                  <button key={s} onClick={() => { apply({ font_size: s }); setSizeMenu(false) }}
                    className={`w-full text-left px-2 py-1 text-[11px] font-mono hover:bg-paper/10 ${
                      s === cur.text.font_size ? "bg-paper/5 text-paper" : "text-muted"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => {
            const cur_ = cur.text.font_size ?? 18
            apply({ font_size: Math.min(200, cur_ + 1) })
          }} disabled={busy}
            className="w-5 h-6 flex items-center justify-center text-[12px] text-muted hover:text-paper border border-edge hover:bg-paper/5"
            title="Increase size"
          >+</button>
        </div>

        <div className="flex gap-0.5">
          <EmphasisBtn label="B" active={!!cur.text.font_bold}      title="Bold (Ctrl+B)"
            onClick={() => apply({ font_bold:      !cur.text.font_bold })}      style={{ fontWeight: 700 }} />
          <EmphasisBtn label="I" active={!!cur.text.font_italic}    title="Italic (Ctrl+I)"
            onClick={() => apply({ font_italic:    !cur.text.font_italic })}    style={{ fontStyle: "italic" }} />
          <EmphasisBtn label="U" active={!!cur.text.font_underline} title="Underline (Ctrl+U)"
            onClick={() => apply({ font_underline: !cur.text.font_underline })} style={{ textDecoration: "underline" }} />
          <EmphasisBtn label="S" active={cur.text.strikethrough === "sng"} title="Strikethrough"
            onClick={() => apply({ strikethrough: cur.text.strikethrough === "sng" ? null : "sng" })}
            style={{ textDecoration: "line-through" }} />
        </div>
      </div>

      {/* Color + caps */}
      <div className="flex flex-col gap-1 justify-center">
        <div className="flex items-center gap-1">
          <label className="relative cursor-pointer" title="Text color">
            <input
              type="color"
              value={cur.text.font_color || "#000000"}
              onChange={(e) => apply({ font_color: e.target.value })}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <span className="h-6 w-12 px-1 bg-base border border-edge flex items-center justify-center gap-1">
              <span className="text-[11px] text-paper">A</span>
              <span className="w-3 h-3 border border-edge" style={{ background: cur.text.font_color || "#000000" }} />
            </span>
          </label>
          <button
            onClick={() => apply({ font_color: null })}
            disabled={busy}
            title="Clear text color"
            className="w-5 h-6 flex items-center justify-center text-[10px] text-muted hover:text-paper border border-edge hover:bg-paper/5"
          >×</button>
        </div>

        <div className="flex gap-0.5">
          <EmphasisBtn label="AA"
            active={cur.text.font_caps === "all"}
            title="All caps"
            onClick={() => apply({ font_caps: cur.text.font_caps === "all" ? null : "all" })}
            style={{ fontSize: 9, letterSpacing: "0.05em" }}
          />
          <EmphasisBtn label="Aa"
            active={cur.text.font_caps === "small"}
            title="Small caps"
            onClick={() => apply({ font_caps: cur.text.font_caps === "small" ? null : "small" })}
            style={{ fontSize: 10 }}
          />
        </div>
      </div>
    </div>
  )
}

function EmphasisBtn({ label, active, title, onClick, style }: {
  label: string; active: boolean; title: string;
  onClick: () => void; style?: React.CSSProperties
}) {
  return (
    <button title={title} onClick={onClick}
      className={`w-7 h-6 flex items-center justify-center text-[12px] border transition-colors ${
        active
          ? "bg-paper/10 text-paper border-paper/30"
          : "border-edge text-muted hover:text-paper hover:bg-paper/5"
      }`}
      style={style}
    >
      {label}
    </button>
  )
}
