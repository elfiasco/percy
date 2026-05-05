import { useState } from "react"
import { removeEmoji } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  onClose: () => void
  onApplied: (affected: number[]) => void
}

export default function EmojiRemoverModal({ docId, slideCount, onClose, onApplied }: Props) {
  const [scope, setScope]         = useState<"all" | "custom">("all")
  const [rangeText, setRangeText] = useState("")
  const [loading, setLoading]     = useState(false)
  const [result, setResult]       = useState<{ changed_slides: number[]; total_chars_removed: number } | null>(null)
  const [error, setError]         = useState("")

  const parseRange = (): number[] | undefined => {
    if (scope === "all") return undefined
    const nums = rangeText.split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= slideCount)
    return nums.length > 0 ? nums : undefined
  }

  const apply = async () => {
    setLoading(true)
    setError("")
    try {
      const slides = parseRange()
      const r = await removeEmoji(docId, slides)
      setResult(r)
      onApplied(r.changed_slides)
    } catch {
      setError("Failed to remove emoji")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[480px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-white font-semibold text-sm">Emoji Remover</h2>
            <p className="text-white/40 text-xs mt-0.5">Strip all emoji from slide text content</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {result && (
            <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
              {result.changed_slides.length === 0
                ? "No emoji found to remove."
                : `Removed emoji from ${result.changed_slides.length} slide${result.changed_slides.length !== 1 ? "s" : ""} (${result.total_chars_removed} chars stripped).`
              }
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-white/60 text-xs font-medium">Scope</label>
            <div className="flex gap-2">
              {(["all", "custom"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1.5 rounded text-xs border transition-colors ${scope === s ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  {s === "all" ? `All Slides (${slideCount})` : "Custom slides"}
                </button>
              ))}
            </div>
            {scope === "custom" && (
              <input
                type="text"
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                placeholder="e.g. 1, 3, 5-8"
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-accent/50"
              />
            )}
          </div>

          <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-2 text-white/40 text-xs">
            This will permanently remove emoji characters (😀🎯💡 etc.) from text. Speaker notes are not affected.
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Cancel</button>
          <button
            onClick={apply}
            disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Removing…" : "Remove Emoji"}
          </button>
        </div>
      </div>
    </div>
  )
}
