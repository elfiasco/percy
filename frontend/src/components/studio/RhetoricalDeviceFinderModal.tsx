import { useState } from "react"
import { fetchRhetoricalDeviceFinder } from "../../lib/studioApi"
import type { RhetoricalDevice } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function RhetoricalDeviceFinderModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ devices: RhetoricalDevice[]; missing_devices: string[]; overall_rhetoric_score: number } | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchRhetoricalDeviceFinder(docId)
      setData(res)
    } catch {
      setError("Failed to analyze rhetorical devices")
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
            <h2 className="text-white font-semibold text-sm">Rhetorical Device Finder</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies anaphora, tricolon, antithesis and more</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Analyzing rhetoric…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-xs text-white/40">
                <span>Rhetoric score:</span>
                <span className={`font-semibold text-sm ${data.overall_rhetoric_score >= 7 ? "text-green-400" : data.overall_rhetoric_score >= 4 ? "text-yellow-400" : "text-red-400"}`}>
                  {data.overall_rhetoric_score}/10
                </span>
              </div>

              {data.devices.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold">Found Devices</p>
                  {data.devices.map((d, i) => (
                    <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-accent font-semibold capitalize">{d.device}</span>
                        <span className="text-[10px] text-white/30">{d.slide_hint}</span>
                      </div>
                      <p className="text-xs text-white/60 italic">"{d.example}"</p>
                      <p className="text-[10px] text-white/40">{d.effect}</p>
                    </div>
                  ))}
                </div>
              )}

              {data.missing_devices.length > 0 && (
                <div>
                  <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold mb-1.5">Missing Devices</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.missing_devices.map((m, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-white/5 text-white/40 capitalize">{m}</span>
                    ))}
                  </div>
                </div>
              )}

              {data.devices.length === 0 && (
                <div className="text-white/30 text-xs text-center py-4">No rhetorical devices identified.</div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Analyze" to find rhetorical devices in your deck.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </div>
    </div>
  )
}
