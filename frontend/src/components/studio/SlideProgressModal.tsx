import { useState, useEffect } from "react"
import { fetchSlideStatuses, setSlideStatus } from "../../lib/studioApi"
import type { SlideWorkflowStatus } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const STATUS_STYLE: Record<string, string> = {
  "todo":         "text-white/40 bg-white/5 border-white/15",
  "in-progress":  "text-blue-400 bg-blue-400/10 border-blue-400/25",
  "done":         "text-green-400 bg-green-400/10 border-green-400/25",
  "needs-review": "text-yellow-400 bg-yellow-400/10 border-yellow-400/25",
}

const STATUS_LABELS: Record<string, string> = {
  "todo":         "Todo",
  "in-progress":  "In Progress",
  "done":         "Done",
  "needs-review": "Needs Review",
}

export default function SlideProgressModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState<{ statuses: Array<{ slide_n: number; status: string }>; counts: Record<string, number>; slide_count: number } | null>(null)
  const [error, setError]       = useState("")
  const [updating, setUpdating] = useState<number | null>(null)

  const reload = async () => {
    try {
      const r = await fetchSlideStatuses(docId)
      setData(r)
    } catch {
      setError("Failed to load slide statuses")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateStatus = async (slideN: number, status: SlideWorkflowStatus) => {
    setUpdating(slideN)
    try {
      await setSlideStatus(docId, slideN, status)
      await reload()
    } catch {
      setError("Failed to update status")
    } finally {
      setUpdating(null)
    }
  }

  const completionPct = data
    ? Math.round((data.counts["done"] || 0) / data.slide_count * 100)
    : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Progress Tracker</h2>
            <p className="text-white/40 text-xs mt-0.5">Track content creation status per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Loading…</span>
            </div>
          ) : data && (
            <>
              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-white/40">Overall completion</span>
                  <span className="text-white/60">{completionPct}%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500/60 rounded-full transition-all"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
              </div>

              {/* Status counts */}
              <div className="grid grid-cols-4 gap-2">
                {(["todo", "in-progress", "done", "needs-review"] as SlideWorkflowStatus[]).map((s) => (
                  <div key={s} className={`rounded-lg border px-2 py-2 text-center ${STATUS_STYLE[s]}`}>
                    <div className="font-semibold text-lg">{data.counts[s] || 0}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{STATUS_LABELS[s]}</div>
                  </div>
                ))}
              </div>

              {/* Slide list */}
              <div className="space-y-1">
                {data.statuses.map((s) => (
                  <div key={s.slide_n} className="flex items-center gap-2 bg-white/3 border border-white/8 rounded px-3 py-1.5">
                    <button
                      onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="text-xs text-white/40 hover:text-accent transition-colors shrink-0 w-14"
                    >
                      Slide {s.slide_n}
                    </button>
                    <div className="flex gap-1 ml-auto">
                      {(["todo", "in-progress", "done", "needs-review"] as SlideWorkflowStatus[]).map((st) => (
                        <button
                          key={st}
                          onClick={() => updateStatus(s.slide_n, st)}
                          disabled={updating === s.slide_n}
                          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${s.status === st ? STATUS_STYLE[st] : "bg-white/3 border-white/8 text-white/25 hover:text-white/50"}`}
                        >
                          {STATUS_LABELS[st]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
