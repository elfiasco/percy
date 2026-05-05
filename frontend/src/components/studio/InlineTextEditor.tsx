/**
 * InlineTextEditor — absolutely-positioned textarea over a slide element.
 * Fetches current text on mount, saves on blur or Ctrl+Enter, cancels on Escape.
 */

import { useEffect, useRef, useState, useCallback } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import { fetchElementText, updateElementText } from "../../lib/studioApi"

interface Props {
  element: StudioElement
  docId: string
  slideN: number
  onCommit: () => void   // called after a successful save → triggers re-render
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
            ta.select()
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
        <div className="w-full h-full flex items-center justify-center bg-black/50 text-white text-xs animate-pulse">
          …
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="w-full h-full resize-none bg-black/60 text-white text-sm
                     border-2 border-paper rounded-sm p-1
                     focus:outline-none focus:border-paper"
          style={{ fontFamily: "inherit", lineHeight: "1.3" }}
          placeholder="Type text… (Ctrl+Enter to save, Esc to cancel)"
        />
      )}
    </div>
  )
}
