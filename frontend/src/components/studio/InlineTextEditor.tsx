/**
 * InlineTextEditor — transparent textarea overlaid on a slide element.
 * Mimics PowerPoint / Google Slides editing: the shape stays visible beneath,
 * a dashed cursor ring shows you're editing, Ctrl+Enter saves, Esc cancels.
 */

import { useEffect, useRef, useState, useCallback } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import { fetchElementText, updateElementText } from "../../lib/studioApi"

interface Props {
  element: StudioElement
  docId: string
  slideN: number
  onCommit: () => void
  onCancel: () => void
}

export default function InlineTextEditor({ element, docId, slideN, onCommit, onCancel }: Props) {
  const [text, setText] = useState("")
  const [loading, setLoading] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetchElementText(docId, slideN, element.id)
      .then((content) => {
        if (content.kind === "paragraphs") {
          const plain = content.paragraphs
            .map((p) => p.runs.map((r) => r.text).join(""))
            .join("\n")
          setText(plain)
        } else {
          setText("")
        }
      })
      .catch(() => setText(""))
      .finally(() => {
        setLoading(false)
        setTimeout(() => {
          const ta = textareaRef.current
          if (ta) {
            ta.focus()
            // Move cursor to end for existing text, or start for empty
            const len = ta.value.length
            ta.setSelectionRange(len, len)
          }
        }, 0)
      })
  }, [docId, slideN, element.id])

  const save = useCallback(async () => {
    const lines = text.split("\n")
    const update = {
      kind: "paragraphs" as const,
      paragraphs: lines.map((line) => ({ runs: [{ text: line }] })),
    }
    try {
      await updateElementText(docId, slideN, element.id, update)
      onCommit()
    } catch (e) {
      console.error("inline text save failed:", e)
      onCancel()
    }
  }, [text, docId, slideN, element.id, onCommit, onCancel])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); return }
  }, [save, onCancel])

  return (
    <div
      style={{
        position:  "absolute",
        left:      `${element.left_pct}%`,
        top:       `${element.top_pct}%`,
        width:     `${element.width_pct}%`,
        height:    `${element.height_pct}%`,
        zIndex:    30000,
        boxSizing: "border-box",
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
      }}
    >
      {loading ? (
        // Transparent while loading — don't flash a dark overlay
        <div className="w-full h-full" style={{ outline: "2px dashed rgba(99,102,241,0.6)" }} />
      ) : (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          placeholder="Type here…"
          style={{
            // Transparent so the rendered shape shows through
            background: "rgba(255,255,255,0.15)",
            // Subtle editing ring — matches PowerPoint's dotted selection
            outline: "2px dashed rgba(99,102,241,0.75)",
            outlineOffset: "1px",
            border: "none",
            // Fill the shape bounds exactly
            width:    "100%",
            height:   "100%",
            resize:   "none",
            // Typography: slide text is typically dark on white
            color:       "#111",
            fontSize:    "clamp(11px, 1.8vh, 18px)",
            lineHeight:  "1.4",
            fontFamily:  "'Segoe UI', system-ui, sans-serif",
            padding:     "4px 6px",
            boxSizing:   "border-box",
          }}
        />
      )}
      {/* Hint badge — bottom-right, like Google Slides */}
      {!loading && (
        <div
          style={{
            position: "absolute",
            bottom: "-20px",
            right: 0,
            fontSize: "9px",
            color: "rgba(99,102,241,0.8)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          Ctrl+Enter to save · Esc to cancel
        </div>
      )}
    </div>
  )
}
