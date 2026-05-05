import { useState } from "react"
import { generateCTA } from "../../lib/studioApi"
import type { CTAData } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onInserted?: (newSlideN: number, count: number) => void
}

export default function CTASlideModal({ docId, onClose, onInserted }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<CTAData | null>(null)
  const [error, setError]     = useState("")
  const [inserted, setInserted] = useState(false)

  const run = async (insert = false) => {
    setLoading(true)
    setError("")
    try {
      const r = await generateCTA(docId, insert)
      setData(r.cta)
      if (insert && r.new_slide_n !== null) {
        setInserted(true)
        onInserted?.(r.new_slide_n, r.slide_count)
      }
    } catch {
      setError("Failed to generate CTA slide")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[500px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Call-to-Action Slide</h2>
            <p className="text-white/40 text-xs mt-0.5">Generate a compelling closing slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-8 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Writing CTA…</p>
            </div>
          )}

          {data && !loading && (
            <div className="bg-white/4 border border-white/10 rounded-lg p-4 space-y-2">
              <p className="text-white font-bold text-lg">{data.title}</p>
              {data.body && <p className="text-white/55 text-sm">{data.body}</p>}
              <div className="inline-block mt-1 px-4 py-1.5 rounded-lg bg-accent/20 border border-accent/30 text-accent text-sm font-medium">
                {data.cta}
              </div>
              {data.subtext && <p className="text-white/30 text-xs mt-1">{data.subtext}</p>}
              {inserted && <p className="text-green-400/60 text-xs pt-1 border-t border-white/5">Added to end of deck</p>}
            </div>
          )}

          {!data && !loading && (
            <p className="text-white/35 text-xs text-center py-4">AI will read your deck and craft a compelling call-to-action.</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <div className="flex gap-2">
            {data && !inserted && (
              <button
                onClick={() => run(true)}
                disabled={loading}
                className="text-sm px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-40 transition-colors"
              >
                Insert Slide
              </button>
            )}
            <button
              onClick={() => run(false)}
              disabled={loading}
              className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
            >
              {loading ? "Writing…" : data ? "Regenerate" : "Generate"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
