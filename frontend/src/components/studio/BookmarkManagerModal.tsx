import { useState, useEffect } from "react"
import { fetchBookmarks, addBookmark, removeBookmark } from "../../lib/studioApi"
import type { Bookmark } from "../../lib/studioApi"

interface Props {
  docId: string
  currentSlide: number
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function BookmarkManagerModal({ docId, currentSlide, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [error, setError]       = useState("")
  const [newLabel, setNewLabel] = useState("")
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    fetchBookmarks(docId)
      .then((r) => setBookmarks(r.bookmarks))
      .catch(() => setError("Failed to load bookmarks"))
      .finally(() => setLoading(false))
  }, [docId])

  const add = async () => {
    setSaving(true)
    try {
      const r = await addBookmark(docId, currentSlide, newLabel)
      setBookmarks(r.bookmarks)
      setNewLabel("")
    } catch {
      setError("Failed to add bookmark")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (slideN: number) => {
    try {
      const r = await removeBookmark(docId, slideN)
      setBookmarks(r.bookmarks)
    } catch {
      setError("Failed to remove bookmark")
    }
  }

  const alreadyBookmarked = bookmarks.some((b) => b.slide_n === currentSlide)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[480px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Bookmark Manager</h2>
            <p className="text-white/40 text-xs mt-0.5">Mark important slides for quick navigation</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {/* Add bookmark for current slide */}
          {!alreadyBookmarked && (
            <div className="flex items-center gap-2 bg-white/3 border border-white/8 rounded-lg px-3 py-2">
              <span className="text-white/40 text-xs shrink-0">Slide {currentSlide}</span>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !saving && add()}
                placeholder="Label (optional)"
                className="flex-1 bg-transparent text-white/70 text-xs outline-none placeholder:text-white/20"
              />
              <button
                onClick={add}
                disabled={saving}
                className="text-xs px-2.5 py-1 rounded bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors shrink-0"
              >
                Bookmark
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Loading…</span>
            </div>
          ) : bookmarks.length === 0 ? (
            <div className="text-white/30 text-sm text-center py-6">No bookmarks yet.</div>
          ) : (
            <div className="space-y-1.5">
              {bookmarks.map((b) => (
                <div key={b.slide_n} className={`flex items-center gap-3 rounded-lg px-3 py-2 border ${b.slide_n === currentSlide ? "bg-accent/8 border-accent/25" : "bg-white/3 border-white/8"}`}>
                  <button
                    onClick={() => { onJumpToSlide(b.slide_n); onClose() }}
                    className="text-xs text-accent/70 hover:text-accent transition-colors shrink-0 w-14"
                  >
                    Slide {b.slide_n}
                  </button>
                  <span className="text-white/55 text-xs flex-1 truncate">{b.label || "Bookmarked"}</span>
                  <button
                    onClick={() => remove(b.slide_n)}
                    className="text-white/25 hover:text-red-400/60 text-xs transition-colors shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
