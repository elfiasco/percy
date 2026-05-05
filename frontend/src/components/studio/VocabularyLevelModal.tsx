import { useState, useEffect } from "react"
import { fetchVocabularyLevel } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const gradeColor = (grade: number) =>
  grade <= 8 ? "text-green-400" : grade <= 12 ? "text-yellow-400" : "text-red-400"

export default function VocabularyLevelModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{
    fk_grade: number
    level: string
    avg_syllables_per_word: number
    complex_words_pct: number
    total_words: number
    total_sentences: number
  } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchVocabularyLevel(docId))
    } catch {
      setError("Failed to analyze vocabulary")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[460px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Vocabulary Level</h2>
            <p className="text-white/40 text-xs mt-0.5">Flesch-Kincaid reading grade level analysis</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Analyzing vocabulary…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-4 bg-white/3 border border-white/8 rounded-xl px-4 py-3">
                <span className={`text-5xl font-bold ${gradeColor(data.fk_grade)}`}>{data.fk_grade}</span>
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-0.5">Reading Grade</p>
                  <p className="text-white/70 text-sm font-medium">{data.level}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Avg. syllables/word", value: data.avg_syllables_per_word },
                  { label: "Complex words", value: `${data.complex_words_pct}%` },
                  { label: "Total words", value: data.total_words.toLocaleString() },
                  { label: "Total sentences", value: data.total_sentences },
                ].map((s) => (
                  <div key={s.label} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                    <p className="text-white/70 font-semibold text-sm">{s.value}</p>
                    <p className="text-white/30 text-[10px] mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="text-xs text-white/35 leading-relaxed bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                {data.fk_grade <= 8
                  ? "Very accessible — suitable for general audiences."
                  : data.fk_grade <= 12
                  ? "Moderate complexity — appropriate for professional audiences."
                  : "Advanced vocabulary — may be difficult for non-specialist audiences."}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
