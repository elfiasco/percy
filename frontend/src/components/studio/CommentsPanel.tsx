/**
 * CommentsPanel — slide-level comments and annotations.
 * Shows comments for the current slide. Add, resolve, or delete.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { fetchComments, addComment, updateComment, deleteComment } from "../../lib/studioApi"
import type { SlideCommentData } from "../../lib/studioApi"

interface Props {
  docId: string
  slideN: number
  onClose: () => void
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function CommentsPanel({ docId, slideN, onClose }: Props) {
  const [comments, setComments] = useState<SlideCommentData[]>([])
  const [loading, setLoading]   = useState(true)
  const [newText, setNewText]   = useState("")
  const [adding, setAdding]     = useState(false)
  const [showAll, setShowAll]   = useState(false)
  const inputRef                = useRef<HTMLTextAreaElement>(null)

  const reload = useCallback(() => {
    const slide = showAll ? undefined : slideN
    fetchComments(docId, slide)
      .then((r) => setComments(r.comments))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [docId, slideN, showAll])

  useEffect(() => { reload() }, [reload])

  const handleAdd = useCallback(async () => {
    const text = newText.trim()
    if (!text) return
    setAdding(true)
    try {
      await addComment(docId, slideN, text)
      setNewText("")
      reload()
    } catch (e) { console.error("add comment failed:", e) }
    finally { setAdding(false) }
  }, [docId, slideN, newText, reload])

  const handleResolve = useCallback(async (id: string, resolved: boolean) => {
    try {
      const updated = await updateComment(docId, id, { resolved })
      setComments((prev) => prev.map((c) => c.id === id ? updated : c))
    } catch (e) { console.error("update comment failed:", e) }
  }, [docId])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteComment(docId, id)
      setComments((prev) => prev.filter((c) => c.id !== id))
    } catch (e) { console.error("delete comment failed:", e) }
  }, [docId])

  const unresolvedCount = comments.filter((c) => !c.resolved).length

  return (
    <div className="fixed right-0 top-0 bottom-0 z-[9998] w-72 bg-surface border-l border-edge
                    flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">💬 Comments</span>
          {unresolvedCount > 0 && (
            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded-full">
              {unresolvedCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAll((v) => !v)}
            title={showAll ? "Show current slide only" : "Show all slides"}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              showAll
                ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                : "border-edge text-muted hover:bg-white/5"
            }`}
          >
            {showAll ? "All slides" : `Slide ${slideN}`}
          </button>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none ml-1">✕</button>
        </div>
      </div>

      {/* comment list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
        {loading ? (
          <div className="text-xs text-muted animate-pulse text-center py-4">Loading…</div>
        ) : comments.length === 0 ? (
          <div className="text-xs text-muted/50 italic text-center py-6">
            {showAll ? "No comments in this document" : `No comments on slide ${slideN}`}
          </div>
        ) : (
          comments.map((c) => (
            <div
              key={c.id}
              className={`rounded-lg p-2.5 border text-xs ${
                c.resolved
                  ? "bg-base/30 border-edge/30 opacity-60"
                  : "bg-base/60 border-edge/60"
              }`}
            >
              {showAll && (
                <div className="text-[9px] text-indigo-300/60 mb-1">Slide {c.slide_n}</div>
              )}
              <div className="flex items-start justify-between gap-1 mb-1">
                <span className="font-medium text-slate-300 text-[11px]">{c.author}</span>
                <span className="text-muted/50 text-[10px] shrink-0">{timeAgo(c.created_at)}</span>
              </div>
              <p className={`text-slate-400 leading-snug mb-2 ${c.resolved ? "line-through" : ""}`}>
                {c.text}
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => handleResolve(c.id, !c.resolved)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                    c.resolved
                      ? "border-edge text-muted hover:bg-white/5"
                      : "border-good/30 text-good bg-good/10 hover:bg-good/20"
                  }`}
                >
                  {c.resolved ? "Reopen" : "✓ Resolve"}
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  className="text-[10px] px-2 py-0.5 rounded border border-edge text-muted hover:text-bad hover:border-bad/30 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* add comment */}
      <div className="p-3 border-t border-edge shrink-0 space-y-2">
        <textarea
          ref={inputRef}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder={`Comment on slide ${slideN}…`}
          rows={3}
          className="w-full text-xs bg-base/60 border border-edge rounded px-2 py-1.5
                     text-slate-300 placeholder:text-muted/50 resize-none
                     focus:outline-none focus:border-accent/50"
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleAdd() }
          }}
        />
        <button
          onClick={handleAdd}
          disabled={adding || !newText.trim()}
          className="w-full text-xs py-1.5 rounded bg-indigo-500/20 text-indigo-300
                     border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors
                     disabled:opacity-40"
        >
          {adding ? "Adding…" : "Add Comment (Ctrl+Enter)"}
        </button>
      </div>
    </div>
  )
}
