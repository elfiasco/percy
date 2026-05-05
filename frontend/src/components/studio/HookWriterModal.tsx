import { useState } from "react"
import { writeSlideHook } from "../../lib/studioApi"

interface Props {
  docId: string
  slideN: number
  onClose: () => void
  onApplied: () => void
}

type HookType = "question" | "statistic" | "story" | "statement" | "quote"

const HOOK_TYPES: { key: HookType; label: string; desc: string; example: string }[] = [
  { key: "question",  label: "Question",   desc: "Thought-provoking question", example: "What would you do if...?" },
  { key: "statistic", label: "Statistic",  desc: "Surprising data point",      example: "83% of people never..." },
  { key: "story",     label: "Micro-Story",desc: "Brief scenario",             example: "Imagine it's 2030..." },
  { key: "statement", label: "Statement",  desc: "Bold, provocative claim",    example: "Everything you know is wrong." },
  { key: "quote",     label: "Quote",      desc: "Relevant quote",             example: '"Innovation is..." — Einstein' },
]

export default function HookWriterModal({ docId, slideN, onClose, onApplied }: Props) {
  const [hookType, setHookType]   = useState<HookType>("question")
  const [loading, setLoading]     = useState(false)
  const [hook, setHook]           = useState("")
  const [error, setError]         = useState("")
  const [applying, setApplying]   = useState(false)
  const [applied, setApplied]     = useState(false)

  const generate = async () => {
    setLoading(true)
    setError("")
    setHook("")
    try {
      const r = await writeSlideHook(docId, slideN, hookType, false)
      setHook(r.hook)
    } catch {
      setError("Failed to generate hook")
    } finally {
      setLoading(false)
    }
  }

  const applyHook = async () => {
    setApplying(true)
    try {
      await writeSlideHook(docId, slideN, hookType, true)
      setApplied(true)
      onApplied()
    } catch {
      setError("Failed to apply hook")
    } finally {
      setApplying(false)
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
            <h2 className="text-white font-semibold text-sm">AI Hook Writer</h2>
            <p className="text-white/40 text-xs mt-0.5">Generate an engaging opening hook for Slide {slideN}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {/* hook type grid */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Hook Style</label>
            <div className="grid grid-cols-5 gap-1.5">
              {HOOK_TYPES.map((ht) => (
                <button
                  key={ht.key}
                  onClick={() => { setHookType(ht.key); setHook("") }}
                  className={`p-2 rounded-lg border text-center transition-colors ${hookType === ht.key ? "bg-accent/15 border-accent/30" : "bg-white/5 border-white/10 hover:border-white/20"}`}
                >
                  <div className={`text-xs font-medium ${hookType === ht.key ? "text-accent" : "text-white/70"}`}>{ht.label}</div>
                  <div className="text-white/25 text-[9px] mt-0.5 leading-tight">{ht.desc}</div>
                </button>
              ))}
            </div>
            <p className="text-white/25 text-[10px] italic">
              e.g. {HOOK_TYPES.find((h) => h.key === hookType)?.example}
            </p>
          </div>

          {/* generate button */}
          <button
            onClick={generate}
            disabled={loading}
            className="w-full py-2 rounded-lg bg-accent/15 border border-accent/30 text-accent text-sm hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2"><span className="animate-spin">✦</span> Generating…</span>
            ) : "Generate Hook"}
          </button>

          {/* hook result */}
          {hook && (
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/15 rounded-lg px-4 py-3">
                <p className="text-white text-sm leading-relaxed italic">"{hook}"</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={generate}
                  className="flex-1 text-xs py-1.5 rounded bg-white/5 border border-white/10 text-white/50 hover:text-white/80 transition-colors"
                >
                  Regenerate
                </button>
                {!applied ? (
                  <button
                    onClick={applyHook}
                    disabled={applying}
                    className="flex-1 text-xs py-1.5 rounded bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 disabled:opacity-40 transition-colors"
                  >
                    {applying ? "Applying…" : "Insert into Slide"}
                  </button>
                ) : (
                  <div className="flex-1 text-xs py-1.5 rounded bg-green-400/10 border border-green-400/20 text-green-400 text-center">
                    ✓ Added to slide
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
