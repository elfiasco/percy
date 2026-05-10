import { useState, useEffect, useRef, useCallback } from "react"
import type { Editor } from "@tiptap/react"

/**
 * Google Slides-style hyperlink popover.
 *
 * Triggered by Ctrl+K when text is selected in any Bridge editor (BridgeText,
 * BridgeShape text, BridgeTable cell). Anchors below the selection bounding
 * box at ~360 px wide. Includes a "Slides in this presentation" picker with
 * meta-targets (First / Last / Next / Previous slide) plus a list of
 * numbered slide titles.
 *
 * Apply behavior:
 *   - URL field empty + nothing selected → no-op
 *   - URL field non-empty → set Tiptap Link mark on the selection
 *   - "Remove" button → unset Link mark
 *
 * The popover is positioned via fixed coordinates supplied by the caller —
 * caller computes them from the active editor's selection rect.
 */

interface SlideInfo { n: number; title: string }

interface Props {
  editor: Editor
  /** Anchor rect in viewport coords (selection bounding box) */
  anchor: { x: number; y: number; w: number; h: number }
  slides: SlideInfo[]
  currentSlideN: number
  onClose: () => void
}

const POPOVER_W = 360
const POPOVER_GAP = 6  // px below selection
const GS_BLUE = "#1a73e8"

export default function HyperlinkPopover({ editor, anchor, slides, currentSlideN, onClose }: Props) {
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl]                 = useState("")
  const [pickerOpen, setPickerOpen]   = useState(false)
  const [hasExistingLink, setHasExistingLink] = useState(false)

  // Initialize URL from existing link mark on selection (if any)
  useEffect(() => {
    const linkAttrs = editor.getAttributes("link") as { href?: string }
    if (linkAttrs?.href) {
      setUrl(linkAttrs.href)
      setHasExistingLink(true)
    }
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editor])

  // Click outside / Escape closes
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose() }
    }
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [onClose])

  const apply = useCallback(() => {
    const trimmed = url.trim()
    if (!trimmed) return
    // Auto-prefix protocol if missing and not a slide-link
    let href = trimmed
    if (!/^[a-z]+:\/\//i.test(href) && !href.startsWith("#slide:") && !href.startsWith("/")) {
      href = `https://${href}`
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
    onClose()
  }, [editor, url, onClose])

  const remove = useCallback(() => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
    onClose()
  }, [editor, onClose])

  // Compute clamped position
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - POPOVER_W - 8))
  const top  = Math.min(anchor.y + anchor.h + POPOVER_GAP, window.innerHeight - 200)

  return (
    <div
      ref={popRef}
      style={{
        position: "fixed",
        left, top,
        width: POPOVER_W,
        zIndex: 100000,
        background: "#fff",
        border: "1px solid #dadce0",
        borderRadius: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.1)",
        fontFamily: "'Google Sans', system-ui, sans-serif",
        fontSize: 13,
        color: "#3c4043",
        padding: 10,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 11, color: "#5f6368", marginBottom: 6, fontWeight: 500 }}>
        Link
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={() => setPickerOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); apply() }
            }}
            placeholder="Paste URL or pick a slide…"
            style={{
              width: "100%", height: 32, fontSize: 13,
              padding: "0 8px",
              border: "1px solid #dadce0", borderRadius: 4,
              outline: "none", color: "#3c4043",
              fontFamily: "inherit",
              background: "#fff",
            }}
            onFocusCapture={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = GS_BLUE }}
            onBlurCapture={(e)  => { (e.currentTarget as HTMLInputElement).style.borderColor = "#dadce0" }}
          />
        </div>
        <button
          onClick={apply}
          disabled={!url.trim()}
          style={{
            padding: "0 14px", height: 32,
            background: url.trim() ? GS_BLUE : "#dadce0",
            color: url.trim() ? "#fff" : "#80868b",
            border: "none", borderRadius: 4,
            cursor: url.trim() ? "pointer" : "not-allowed",
            fontSize: 13, fontWeight: 500,
            fontFamily: "inherit",
          }}
        >
          Apply
        </button>
      </div>

      {/* Slides in this presentation */}
      {pickerOpen && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "#5f6368", margin: "4px 0", fontWeight: 500 }}>
            Slides in this presentation
          </div>
          <div style={{
            maxHeight: 180, overflowY: "auto",
            border: "1px solid #f1f3f4", borderRadius: 4,
            background: "#fff",
          }}>
            {/* Meta-targets (Google Slides parity: First / Last / Next / Previous) */}
            {[
              { label: "First slide",    href: "#slide:first" },
              { label: "Last slide",     href: "#slide:last" },
              { label: "Next slide",     href: "#slide:next" },
              { label: "Previous slide", href: "#slide:prev" },
            ].map((m) => (
              <SlideRow key={m.href} label={m.label} onClick={() => setUrl(m.href)} />
            ))}
            <div style={{ height: 1, background: "#f1f3f4", margin: "4px 0" }} />
            {slides.length === 0 && (
              <div style={{ padding: "6px 12px", fontSize: 12, color: "#80868b" }}>
                No other slides
              </div>
            )}
            {slides.map((s) => (
              <SlideRow
                key={s.n}
                label={`${s.n}. ${s.title || "Untitled"}`}
                current={s.n === currentSlideN}
                onClick={() => setUrl(`#slide:${s.n}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bottom row: Remove (if existing link) + Close */}
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        {hasExistingLink && (
          <button
            onClick={remove}
            style={{
              padding: "6px 12px", height: 28,
              background: "transparent",
              color: "#d93025",
              border: "1px solid transparent", borderRadius: 4,
              cursor: "pointer",
              fontSize: 12, fontWeight: 500,
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#fce8e6" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
          >
            Remove link
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            padding: "6px 12px", height: 28,
            background: "transparent",
            color: "#5f6368",
            border: "1px solid transparent", borderRadius: 4,
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function SlideRow({ label, current, onClick }: { label: string; current?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "5px 12px", fontSize: 12,
        background: current ? "#e8f0fe" : "transparent",
        color: current ? "#1a73e8" : "#3c4043",
        border: "none", cursor: "pointer",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => { if (!current) (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
      onMouseLeave={(e) => { if (!current) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
    >
      {label}
    </button>
  )
}
