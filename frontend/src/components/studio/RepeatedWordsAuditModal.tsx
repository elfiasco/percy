import { useState, useEffect } from "react"
import { fetchRepeatedWordsAudit } from "../../lib/studioApi"
import type { RepeatedWord } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function RepeatedWordsAuditModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ repeated_words: RepeatedWord[]; total_unique: number; min_threshold: number } | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchRepeatedWordsAudit(docId)
      .then(setData)
      .catch(() => setError("Failed to audit repeated words"))
      .finally(() => setLoading(false))
  }, [docId])

  const maxCount = data ? Math.max(...data.repeated_words.map(w => w.count), 1) : 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Repeated Words Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">Words used excessively across the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Auditing word frequency…</p>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="text-xs text-white/40">
                Showing words used ≥{data.min_threshold} times · <span className="text-white/60">{data.total_unique} unique words total</span>
              </div>

              {data.repeated_words.length === 0 ? (
                <div className="text-green-400 text-xs text-center py-4">No overly repeated words found.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.repeated_words.map((w, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-white/60 w-24 shrink-0 font-mono">{w.word}</span>
                      <div className="flex-1 h-3 bg-white/5 rounded-sm overflow-hidden">
                        <div
                          className={`h-full rounded-sm ${w.count >= 15 ? "bg-red-400/50" : w.count >= 8 ? "bg-yellow-400/40" : "bg-accent/30"}`}
                          style={{ width: `${(w.count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-white/40 w-12 text-right shrink-0">{w.count}×</span>
                    </div>
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
