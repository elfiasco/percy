import { useState, useEffect, useCallback, useRef } from "react"
import type { StudioElement, ParagraphsTextContent } from "../../lib/studioTypes"
import { fetchElementText, updateElementText } from "../../lib/studioApi"
import {
  applyFormatToAllRuns, applyParagraphFormat, readCurrentFormat,
  COMMON_FONTS, COMMON_SIZES,
  type TextFormat, type ParagraphFormat,
} from "../../lib/textFormat"
import { tryApplyToSelection, getActiveEditor, subscribeSelectionChange, subscribeActiveEditor } from "../../lib/textEditingBus"

/**
 * TextFormatGroup — PowerPoint-style text controls for the Home ribbon.
 *
 * Visible only when a text-capable element is selected. Reads the current
 * text content on mount so toggle states (bold, italic, etc.) reflect the
 * element's actual format. Each control:
 *   1. fetches latest paragraphs (in case another part of the app changed them)
 *   2. mutates every run / paragraph
 *   3. saves back via updateElementText
 *
 * Today this applies to the *whole element* (the inline text editor doesn't
 * yet support selection ranges). When the rich-text editor lands, swap in
 * applyFormatToRange — the ribbon's UX doesn't have to change.
 */

interface Props {
  element:     StudioElement
  docId:       string
  slideN:      number
  onCommit?:   () => void
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

  // Pull current text on mount/element-change so toggle indicators are correct
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

  // Close popovers on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (fontMenu && fontRef.current && !fontRef.current.contains(e.target as Node)) setFontMenu(false)
      if (sizeMenu && sizeRef.current && !sizeRef.current.contains(e.target as Node)) setSizeMenu(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [fontMenu, sizeMenu])

  // Selection-aware format: when an editor is active for this element, mirror
  // the *current selection's* format so toggles reflect what's selected, not
  // just the element's first run. Bumps a version counter so we re-derive on
  // selectionchange / editor-mount / editor-unmount.
  const [selVersion, setSelVersion] = useState(0)
  useEffect(() => {
    const bump = () => setSelVersion((v) => v + 1)
    const offSel    = subscribeSelectionChange(bump)
    const offEditor = subscribeActiveEditor(bump)
    return () => { offSel(); offEditor() }
  }, [])

  const elementCur = readCurrentFormat(content)
  const liveCur = (() => {
    const active = getActiveEditor()
    if (!active || active.elementId !== element.id) return null
    return active.readSelectionFormat?.() ?? null
  })()
  // Use live selection format if available, else fall back to element-level format
  const cur = liveCur ?? elementCur
  void selVersion

  const apply = useCallback(async (
    text: TextFormat = {},
    para: ParagraphFormat = {},
  ) => {
    // If a contentEditable is currently active for this element, format the
    // live selection inside it instead of rewriting every run on the server.
    if (tryApplyToSelection(element.id, text, para)) return

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

  // ── derived UI state ─────────────────────────────────────────────────────
  const fontDisplay = cur.text.font_name || "Mixed"
  const sizeDisplay = cur.text.font_size != null ? String(cur.text.font_size) : "—"
  const align       = cur.paragraph.alignment ?? "left"

  return (
    <div className="flex h-full items-stretch gap-1 px-1 py-1.5">
      {/* Font + size */}
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
            <div className="absolute left-0 top-full mt-1 z-50 w-56 max-h-72 overflow-y-auto bg-surface border border-edge shadow-2xl">
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

        {/* alignment row */}
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
              <div className="absolute left-0 top-full mt-1 z-50 w-16 max-h-72 overflow-y-auto bg-surface border border-edge shadow-2xl">
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

        {/* emphasis row: B I U S */}
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
              <span className="text-[11px] text-paper" style={{ textShadow: "0 0 0 currentColor" }}>A</span>
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
