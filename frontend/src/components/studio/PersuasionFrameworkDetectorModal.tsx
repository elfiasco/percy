import { useState } from "react"
import { fetchPersuasionFrameworkDetector } from "../../lib/studioApi"
import type { PersuasionFramework } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const confidenceColor = (c: PersuasionFramework["confidence"]) => ({
  high:   "text-green-400 border-green-400/20 bg-green-400/8",
  medium: "text-yellow-400 border-yellow-400/20 bg-yellow-400/8",
  low:    "text-white/40 border-white/10 bg-white/5",
})[c]

export default function PersuasionFrameworkDetectorModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ detected: PersuasionFramework[]; dominant_framework: string; missing_elements: string[] } | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchPersuasionFrameworkDetector(docId)
      setData(res)
    } catch {
      setError("Failed to detect persuasion frameworks")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Persuasion Framework Detector</h2>
            <p className="text-white/40 text-xs mt-0.5">AI detects AIDA, PAS, FAB and other frameworks</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Detecting frameworks…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              {data.dominant_framework && (
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <span>Dominant framework:</span>
                  <span className="text-accent font-semibold">{data.dominant_framework}</span>
                </div>
              )}

              {data.detected.length > 0 && (
                <div className="space-y-2">
                  {data.detected.map((f, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <h3 className="text-white/80 text-xs font-semibold flex-1">{f.framework}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded border ${confidenceColor(f.confidence)}`}>{f.confidence}</span>
                        <span className="text-[10px] text-white/40">{f.completeness}/10</span>
                      </div>
                      <p className="text-xs text-white/55 leading-relaxed">{f.evidence}</p>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-accent/40 rounded-full" style={{ width: `${(f.completeness / 10) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {data.missing_elements.length > 0 && (
                <div>
                  <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold mb-1.5">Missing Elements</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.missing_elements.map((m, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded border border-red-400/20 bg-red-400/8 text-red-400/70">{m}</span>
                    ))}
                  </div>
                </div>
              )}

              {data.detected.length === 0 && (
                <div className="text-white/30 text-xs text-center py-4">No persuasion frameworks detected.</div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Detect" to identify persuasion frameworks.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Detecting…" : "Detect"}
          </button>
        </div>
      </div>
    </div>
  )
}
