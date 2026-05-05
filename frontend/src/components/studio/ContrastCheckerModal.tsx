import { useState, useEffect } from "react"
import { fetchContrastCheck } from "../../lib/studioApi"
import type { ContrastResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const LEVEL_STYLE: Record<string, string> = {
  AAA:         "text-green-400 bg-green-400/10 border-green-400/20",
  AA:          "text-green-300 bg-green-300/10 border-green-300/20",
  "AA Large":  "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  Fail:        "text-red-400 bg-red-400/10 border-red-400/20",
}

function ColorSwatch({ hex }: { hex: string }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-sm border border-white/20 shrink-0"
      style={{ backgroundColor: hex }}
    />
  )
}

export default function ContrastCheckerModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState<{ results: ContrastResult[]; total: number; passing: number; failing: number; slide_count: number } | null>(null)
  const [error, setError]       = useState("")
  const [filter, setFilter]     = useState<"all" | "pass" | "fail">("all")

  useEffect(() => {
    fetchContrastCheck(docId)
      .then(setData)
      .catch(() => setError("Failed to run contrast check"))
      .finally(() => setLoading(false))
  }, [docId])

  const filtered = data?.results
    ? data.results.filter((r) => filter === "all" ? true : filter === "pass" ? r.pass : !r.pass)
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Contrast Checker</h2>
            <p className="text-white/40 text-xs mt-0.5">WCAG contrast ratios — text legibility check</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Checking contrast ratios…</p>
            </div>
          ) : data && (
            <>
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <div className="text-white/80 font-semibold text-lg">{data.total}</div>
                  <div className="text-white/35 text-xs mt-0.5">Checked</div>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <div className="text-green-400 font-semibold text-lg">{data.passing}</div>
                  <div className="text-white/35 text-xs mt-0.5">Pass</div>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-center">
                  <div className={`font-semibold text-lg ${data.failing > 0 ? "text-red-400" : "text-white/40"}`}>{data.failing}</div>
                  <div className="text-white/35 text-xs mt-0.5">Fail</div>
                </div>
              </div>

              {data.total === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-white/30 gap-2">
                  <p className="text-sm">No explicit text colors found to check.</p>
                  <p className="text-xs opacity-60">Elements without explicit color settings are not checked.</p>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    {(["all", "pass", "fail"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-2.5 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-1.5">
                    {filtered.map((r, i) => (
                      <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <ColorSwatch hex={r.text_color} />
                          <span className="text-white/30 text-[10px]">on</span>
                          <ColorSwatch hex={r.bg_color} />
                          <span className="text-white/50 text-xs font-mono">{r.ratio}:1</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${LEVEL_STYLE[r.level]}`}>{r.level}</span>
                          <button
                            onClick={() => { onJumpToSlide(r.slide_n); onClose() }}
                            className="ml-auto text-[10px] text-accent/50 hover:text-accent transition-colors"
                          >
                            Slide {r.slide_n} ↗
                          </button>
                        </div>
                        {r.preview && (
                          <p className="text-white/30 text-[10px] mt-1 truncate">"{r.preview}"</p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex items-center justify-between">
          <span className="text-white/20 text-[10px]">WCAG 2.1 — AA requires 4.5:1 (normal text)</span>
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
