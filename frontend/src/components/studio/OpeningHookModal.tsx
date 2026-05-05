import { useState } from "react"
import { fetchOpeningHook } from "../../lib/studioApi"
import type { OpeningHookResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onApplied?: () => void
}

export default function OpeningHookModal({ docId, onClose, onApplied }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<OpeningHookResult | null>(null)
  const [error, setError]     = useState("")
  const [applied, setApplied] = useState(false)

  const run = async (apply = false) => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchOpeningHook(docId, apply)
      setData(r.result)
      if (apply) { setApplied(true); onApplied?.() }
    } catch {
      setError("Failed to generate opening hook")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Opening Hook Rewriter</h2>
            <p className="text-white/40 text-xs mt-0.5">AI rewrites your title slide as an attention-grabber</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs py-4">
              <div className="animate-spin text-base">✦</div>
              <span>Crafting hook…</span>
            </div>
          ) : data ? (
            <div className="space-y-3">
              <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
                <p className="text-white/30 text-[10px] mb-1 uppercase tracking-wide">Original</p>
                <p className="text-white/45 text-xs leading-relaxed">{data.original}</p>
              </div>
              <div className="bg-accent/5 border border-accent/20 rounded-lg px-3 py-2.5">
                <p className="text-accent/50 text-[10px] mb-1 uppercase tracking-wide">Hook</p>
                <p className="text-white/80 text-sm font-medium">{data.hook}</p>
                {data.subhook && <p className="text-white/50 text-xs mt-1">{data.subhook}</p>}
              </div>
              {applied && <p className="text-green-400/60 text-xs">Applied to title slide</p>}
            </div>
          ) : (
            <p className="text-white/35 text-xs text-center py-4">AI will rewrite your opening slide as a punchy hook.</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <div className="flex gap-2">
            {data && !applied && (
              <button
                onClick={() => run(true)}
                disabled={loading}
                className="text-sm px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-40 transition-colors"
              >
                Apply to Slide 1
              </button>
            )}
            <button
              onClick={() => run(false)}
              disabled={loading}
              className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
            >
              {loading ? "Writing…" : data ? "Regenerate" : "Generate Hook"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
