import { useState, useEffect } from "react"
import { fetchTableCountAudit } from "../../lib/studioApi"
import type { TableCountSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

export default function TableCountAuditModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ per_slide: TableCountSlide[]; total_tables: number; flagged_slides: number[] } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchTableCountAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit tables"))
      .finally(() => setLoading(false))
  }, [docId])

  const withTables = data ? data.per_slide.filter(s => s.table_count > 0) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Table Count Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Tables per slide — detects complex or empty tables</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing tables…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-6 text-xs text-white/40">
                <span>Total tables: <span className="text-white/70">{data.total_tables}</span></span>
                <span>Flagged: <span className="text-yellow-400">{data.flagged_slides.length} slides</span></span>
              </div>

              {withTables.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-4">No tables found in this deck.</div>
              ) : (
                <div className="space-y-2">
                  {withTables.map(s => (
                    <button key={s.slide_n} onClick={() => { onJumpToSlide(s.slide_n); onClose() }}
                      className="w-full flex items-start gap-3 text-left hover:bg-white/5 rounded-lg px-3 py-2.5 transition-colors border border-white/5">
                      <span className="text-[10px] text-white/40 shrink-0 w-14">Slide {s.slide_n}</span>
                      <div className="flex-1 space-y-1">
                        {s.tables.map((t, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-[10px] text-white/50">{t.rows}×{t.cols}</span>
                            {t.empty && <span className="text-[10px] text-red-400/70 border border-red-400/20 bg-red-400/8 px-1 rounded">empty</span>}
                            {t.complex && <span className="text-[10px] text-yellow-400/70 border border-yellow-400/20 bg-yellow-400/8 px-1 rounded">complex</span>}
                          </div>
                        ))}
                      </div>
                      <span className="text-[10px] text-white/30 shrink-0">{s.table_count} table{s.table_count !== 1 ? "s" : ""}</span>
                    </button>
                  ))}
                </div>
              )}
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
