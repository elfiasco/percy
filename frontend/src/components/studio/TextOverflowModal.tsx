import { useState, useEffect } from "react"
import { fetchTextOverflow } from "../../lib/studioApi"
import type { TextOverflowViolation } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

interface SlideGroup {
  slide_n: number
  items: TextOverflowViolation[]
}

export default function TextOverflowModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(true)
  const [groups, setGroups]   = useState<SlideGroup[] | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchTextOverflow(docId)
      const map: Record<number, TextOverflowViolation[]> = {}
      for (const v of res.violations) {
        if (!map[v.slide_n]) map[v.slide_n] = []
        map[v.slide_n].push(v)
      }
      setGroups(Object.keys(map).map(Number).sort((a, b) => a - b).map(n => ({ slide_n: n, items: map[n] })))
    } catch {
      setError("Failed to check text overflow")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = groups ? groups.reduce((s, g) => s + g.items.length, 0) : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Text Overflow Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Find text boxes where content may be clipped</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Scanning for overflow…</span>
            </div>
          )}

          {!loading && groups !== null && (
            total === 0 ? (
              <div className="text-green-400/80 text-xs bg-green-400/8 border border-green-400/20 rounded-lg px-3 py-3 text-center">
                No text overflow detected.
              </div>
            ) : (
              <>
                <div className="text-yellow-400/70 text-xs">
                  {total} overflow{total !== 1 ? "s" : ""} found across {groups.length} slide{groups.length !== 1 ? "s" : ""}
                </div>
                <div className="space-y-2">
                  {groups.map((g) => (
                    <div key={g.slide_n} className="bg-white/3 border border-white/8 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
                        <button onClick={() => { onJumpToSlide(g.slide_n); onClose() }}
                          className="text-xs text-accent/70 hover:text-accent transition-colors">
                          Slide {g.slide_n}
                        </button>
                        <span className="text-white/25 text-xs ml-auto">{g.items.length} element{g.items.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="divide-y divide-white/5">
                        {g.items.map((v, i) => (
                          <div key={i} className="px-3 py-2 space-y-0.5">
                            <p className="text-white/60 text-xs truncate">{v.element_name}</p>
                            <p className="text-white/30 text-[10px] font-mono">
                              box {v.box_w}" × {v.box_h}" · text ~{v.est_text_h}"
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Scanning…" : "Re-scan"}
          </button>
        </div>
      </div>
    </div>
  )
}
