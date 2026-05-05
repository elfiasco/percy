import { useState, useEffect } from "react"
import type { SlideDensity } from "../../lib/studioApi"
import { fetchContentDensity } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const LABEL_STYLES: Record<string, { cls: string; bar: string }> = {
  sparse:  { cls: "text-sky-400",    bar: "bg-sky-500" },
  ideal:   { cls: "text-green-400",  bar: "bg-green-500" },
  dense:   { cls: "text-amber-400",  bar: "bg-amber-500" },
  crowded: { cls: "text-red-400",    bar: "bg-red-500" },
}

type SortKey = "slide_n" | "word_count" | "el_count" | "density_score"

export default function ContentDensityModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [slides, setSlides]     = useState<SlideDensity[]>([])
  const [summary, setSummary]   = useState({ total: 0, avg: 0, crowded: [] as number[], sparse: [] as number[] })
  const [sortKey, setSortKey]   = useState<SortKey>("slide_n")
  const [sortDesc, setSortDesc] = useState(false)
  const [filterLabel, setFilterLabel] = useState<string | null>(null)
  const [error, setError]       = useState("")

  useEffect(() => {
    fetchContentDensity(docId)
      .then((r) => {
        setSlides(r.slides)
        setSummary({ total: r.deck_total_words, avg: r.avg_words_per_slide, crowded: r.crowded_slides, sparse: r.sparse_slides })
      })
      .catch(() => setError("Failed to load content density data."))
      .finally(() => setLoading(false))
  }, [docId])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((d) => !d)
    else { setSortKey(key); setSortDesc(false) }
  }

  const visible = [...slides]
    .filter((s) => !filterLabel || s.label === filterLabel)
    .sort((a, b) => {
      const va = a[sortKey] as number
      const vb = b[sortKey] as number
      return sortDesc ? vb - va : va - vb
    })

  const maxWords = Math.max(1, ...slides.map((s) => s.word_count))

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => handleSort(k)}
      className={`text-[10px] hover:text-white/80 transition-colors ${sortKey === k ? "text-accent" : "text-white/30"}`}
    >
      {label}{sortKey === k ? (sortDesc ? " ↓" : " ↑") : ""}
    </button>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[680px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Content Density</h2>
            <p className="text-white/40 text-xs mt-0.5">Word counts and crowding analysis per slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-10 text-white/40">
              <span className="animate-pulse">Analyzing…</span>
            </div>
          )}

          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!loading && slides.length > 0 && (
            <>
              {/* summary row */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Total Words", value: summary.total.toLocaleString() },
                  { label: "Avg / Slide",  value: summary.avg.toFixed(1) },
                  { label: "Crowded",      value: summary.crowded.length, warn: summary.crowded.length > 0 },
                  { label: "Sparse",       value: summary.sparse.length,  warn: summary.sparse.length > 0 },
                ].map((stat) => (
                  <div key={stat.label} className="bg-white/5 rounded-lg px-3 py-2 text-center">
                    <div className={`text-lg font-mono font-semibold ${stat.warn ? "text-amber-400" : "text-white"}`}>{stat.value}</div>
                    <div className="text-white/30 text-[10px] mt-0.5">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* filter tabs */}
              <div className="flex gap-1.5">
                {[null, "sparse", "ideal", "dense", "crowded"].map((lbl) => {
                  const count = lbl ? slides.filter((s) => s.label === lbl).length : slides.length
                  const styles = lbl ? LABEL_STYLES[lbl] : null
                  return (
                    <button
                      key={lbl ?? "all"}
                      onClick={() => setFilterLabel(lbl)}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors capitalize ${
                        filterLabel === lbl
                          ? "border-white/30 bg-white/10 text-white"
                          : `border-white/10 ${styles?.cls ?? "text-white/40"} hover:opacity-80`
                      }`}
                    >
                      {lbl ?? "All"} ({count})
                    </button>
                  )
                })}
              </div>

              {/* table */}
              <div>
                <div className="flex items-center gap-2 px-2 mb-1.5">
                  <div className="w-10"><SortBtn k="slide_n" label="#" /></div>
                  <div className="flex-1"><span className="text-[10px] text-white/30">Word bar</span></div>
                  <div className="w-12 text-right"><SortBtn k="word_count" label="Words" /></div>
                  <div className="w-10 text-right"><SortBtn k="el_count" label="Elem" /></div>
                  <div className="w-14 text-right"><SortBtn k="density_score" label="Score" /></div>
                  <div className="w-16 text-right"><span className="text-[10px] text-white/30">Label</span></div>
                </div>

                <div className="space-y-0.5">
                  {visible.map((s) => {
                    const style = LABEL_STYLES[s.label]
                    const barW  = (s.word_count / maxWords) * 100
                    return (
                      <button
                        key={s.slide_n}
                        onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors group"
                      >
                        <div className="w-10 text-xs text-accent group-hover:text-accent/80 font-mono text-left">
                          {s.slide_n}
                        </div>
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div className={`h-full ${style.bar} rounded-full transition-all`} style={{ width: `${barW}%` }} />
                        </div>
                        <div className="w-12 text-right text-xs text-white/60 font-mono">{s.word_count}</div>
                        <div className="w-10 text-right text-xs text-white/40 font-mono">{s.el_count}</div>
                        <div className="w-14 text-right text-xs text-white/60 font-mono">{s.density_score}</div>
                        <div className={`w-16 text-right text-[10px] ${style.cls} capitalize`}>{s.label}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
