import { useState, useEffect } from "react"
import { fetchSlideLayoutTypeAudit } from "../../lib/studioApi"
import type { LayoutSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const layoutColor: Record<string, string> = {
  blank:        "text-white/30 border-white/10 bg-white/5",
  image_only:   "text-blue-400 border-blue-400/20 bg-blue-400/8",
  image_text:   "text-cyan-400 border-cyan-400/20 bg-cyan-400/8",
  title_only:   "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  title_content:"text-green-400 border-green-400/20 bg-green-400/8",
  two_column:   "text-accent border-accent/20 bg-accent/8",
  multi_column: "text-paper border-paper/20 bg-paper/8",
  complex:      "text-red-400 border-red-400/20 bg-red-400/8",
}

export default function SlideLayoutTypeAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ slides: LayoutSlide[]; distribution: Record<string, number> } | null>(null)
  const [error, setError] = useState("")
  const [activeLayout, setActiveLayout] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchSlideLayoutTypeAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit slide layouts"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data
    ? (activeLayout ? data.slides.filter(s => s.layout === activeLayout) : data.slides)
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Layout Type Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Classifies each slide by its layout pattern</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing layouts…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setActiveLayout(null)}
                  className={`text-[10px] px-2.5 py-1 rounded border transition-colors ${!activeLayout ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-white/40"}`}>
                  All ({data.slides.length})
                </button>
                {Object.entries(data.distribution).sort((a, b) => b[1] - a[1]).map(([layout, count]) => (
                  <button key={layout} onClick={() => setActiveLayout(activeLayout === layout ? null : layout)}
                    className={`text-[10px] px-2.5 py-1 rounded border capitalize transition-colors ${activeLayout === layout ? (layoutColor[layout] ?? "text-white/50 border-white/15 bg-white/5") : "bg-white/5 border-white/10 text-white/40"}`}>
                    {layout.replace("_", " ")} ({count})
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                {filtered.map(s => (
                  <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                    className="w-full flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
                    <span className="text-[10px] text-white/40 w-14 shrink-0">Slide {s.slide_n}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border capitalize ${layoutColor[s.layout] ?? "text-white/40 border-white/10 bg-white/5"}`}>
                      {s.layout.replace(/_/g, " ")}
                    </span>
                  </button>
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
