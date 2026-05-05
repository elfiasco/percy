import { useState, useEffect } from "react"
import { fetchStyleGuide } from "../../lib/studioApi"
import type { StyleGuideFont, StyleGuideColor, StyleGuideFontSize } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function StyleGuideModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ fonts: StyleGuideFont[]; colors: StyleGuideColor[]; font_sizes: StyleGuideFontSize[]; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  useEffect(() => {
    fetchStyleGuide(docId)
      .then(setData)
      .catch(() => setError("Failed to extract style guide"))
      .finally(() => setLoading(false))
  }, [docId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Deck Style Guide</h2>
            <p className="text-white/40 text-xs mt-0.5">Extracted fonts, colors, and type scale</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <div className="animate-spin text-base">✦</div>
              <span>Extracting style data…</span>
            </div>
          ) : data && (
            <>
              {data.fonts.length > 0 && (
                <div>
                  <p className="text-white/50 text-xs font-medium mb-2 uppercase tracking-wide">Fonts</p>
                  <div className="space-y-1.5">
                    {data.fonts.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded px-3 py-2">
                        <span className="text-white/70 text-sm flex-1" style={{ fontFamily: f.font }}>{f.font}</span>
                        <span className="text-white/25 text-xs font-mono">{f.count}×</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.colors.length > 0 && (
                <div>
                  <p className="text-white/50 text-xs font-medium mb-2 uppercase tracking-wide">Colors</p>
                  <div className="flex flex-wrap gap-2">
                    {data.colors.map((c, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-white/3 border border-white/8 rounded px-2.5 py-1.5">
                        <div
                          className="w-4 h-4 rounded border border-white/20 shrink-0"
                          style={{ backgroundColor: c.color }}
                        />
                        <span className="text-white/55 text-xs font-mono">{c.color}</span>
                        <span className="text-white/20 text-[10px]">{c.count}×</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.font_sizes.length > 0 && (
                <div>
                  <p className="text-white/50 text-xs font-medium mb-2 uppercase tracking-wide">Type Scale</p>
                  <div className="space-y-1">
                    {data.font_sizes.map((s, i) => (
                      <div key={i} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded px-3 py-1.5">
                        <span className="text-white/60 font-mono text-xs w-8">{s.size}pt</span>
                        <span className="text-white/30 text-xs capitalize flex-1">{s.role}</span>
                        <span className="text-white/20 text-[10px]">{s.count}×</span>
                      </div>
                    ))}
                  </div>
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
