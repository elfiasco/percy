import { useState } from "react"
import { fetchSlideThemeExtractor } from "../../lib/studioApi"
import type { ThemeExtractorResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function SlideThemeExtractorModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ThemeExtractorResult | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSlideThemeExtractor(docId)
      setData(res)
    } catch {
      setError("Failed to extract themes")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Theme Extractor</h2>
            <p className="text-white/40 text-xs mt-0.5">AI identifies the key themes running through your presentation</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting themes…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-3">
              {data.themes.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-6">No themes extracted.</div>
              ) : data.themes
                .sort((a, b) => b.relevance - a.relevance)
                .map((theme, i) => (
                  <div key={i} className="border border-white/8 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-3">
                      <p className="flex-1 text-[12px] text-white/80 font-medium">{theme.theme}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-accent/50 rounded-full" style={{ width: `${theme.relevance * 10}%` }} />
                        </div>
                        <span className="text-[10px] text-white/30">{theme.relevance}/10</span>
                      </div>
                    </div>
                    {theme.description && (
                      <p className="text-[10px] text-white/40 leading-relaxed">{theme.description}</p>
                    )}
                    {theme.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {theme.keywords.map((kw, j) => (
                          <span key={j} className="text-[9px] text-white/30 bg-white/5 border border-white/8 px-1.5 py-0.5 rounded">{kw}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              }
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Extract" to identify presentation themes.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Extracting…" : "Extract"}
          </button>
        </div>
      </div>
    </div>
  )
}
