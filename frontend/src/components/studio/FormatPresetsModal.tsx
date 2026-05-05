import { useState } from "react"
import { applyFormatPreset } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onApplied: (affected: number[]) => void
}

const PRESETS = [
  {
    key: "corporate",
    label: "Corporate",
    desc: "Clean business style — dark navy titles, muted body",
    title: { size: "28pt", bold: true,  color: "#1E293B" },
    body:  { size: "14pt", bold: false, color: "#475569" },
  },
  {
    key: "executive",
    label: "Executive",
    desc: "Board-ready — large bold titles, structured layout",
    title: { size: "32pt", bold: true,  color: "#0F172A" },
    body:  { size: "16pt", bold: false, color: "#334155" },
  },
  {
    key: "startup",
    label: "Startup",
    desc: "Bold and modern — white text for dark backgrounds",
    title: { size: "30pt", bold: true,  color: "#FFFFFF" },
    body:  { size: "14pt", bold: false, color: "#CBD5E1" },
  },
  {
    key: "minimal",
    label: "Minimal",
    desc: "Light, airy — small fonts, maximum whitespace",
    title: { size: "24pt", bold: false, color: "#0F172A" },
    body:  { size: "12pt", bold: false, color: "#64748B" },
  },
  {
    key: "academic",
    label: "Academic",
    desc: "Scholarly tone — deep navy headings",
    title: { size: "24pt", bold: true,  color: "#1E3A5F" },
    body:  { size: "12pt", bold: false, color: "#334155" },
  },
]

export default function FormatPresetsModal({ docId, slideCount, currentSlide, onClose, onApplied }: Props) {
  const [selected, setSelected]   = useState<string | null>(null)
  const [scope, setScope]         = useState<"all" | "current">("all")
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState("")
  const [result, setResult]       = useState<number[] | null>(null)

  const apply = async () => {
    if (!selected) { setError("Please select a preset"); return }
    setLoading(true)
    setError("")
    try {
      const slides = scope === "current" ? [currentSlide] : undefined
      const r = await applyFormatPreset(docId, selected, slides)
      setResult(r.affected_slides)
      onApplied(r.affected_slides)
    } catch {
      setError("Failed to apply preset")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[540px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Quick Format Presets</h2>
            <p className="text-white/40 text-xs mt-0.5">Normalize font sizes and colors with one click</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {result && (
            <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
              Applied "{selected}" to {result.length} slide{result.length !== 1 ? "s" : ""}.
            </div>
          )}

          {/* presets grid */}
          <div className="space-y-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setSelected(p.key)}
                className={`w-full flex items-center gap-4 rounded-lg border px-4 py-3 text-left transition-all ${selected === p.key ? "bg-accent/10 border-accent/40" : "bg-white/3 border-white/10 hover:border-white/20"}`}
              >
                {/* preview strip */}
                <div className="shrink-0 space-y-1 w-28">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      backgroundColor: p.title.color,
                      width: "85%",
                      opacity: 0.9,
                    }}
                  />
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      backgroundColor: p.body.color,
                      width: "65%",
                      opacity: 0.7,
                    }}
                  />
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      backgroundColor: p.body.color,
                      width: "75%",
                      opacity: 0.5,
                    }}
                  />
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${selected === p.key ? "text-accent" : "text-white/80"}`}>{p.label}</div>
                  <div className="text-white/35 text-xs mt-0.5">{p.desc}</div>
                  <div className="flex gap-3 mt-1">
                    <span className="text-white/20 text-[10px]">Title: {p.title.size}{p.title.bold ? " bold" : ""}</span>
                    <span className="text-white/20 text-[10px]">Body: {p.body.size}</span>
                  </div>
                </div>
                {selected === p.key && <span className="text-accent text-sm shrink-0">✓</span>}
              </button>
            ))}
          </div>

          {/* scope */}
          <div className="space-y-1.5">
            <label className="text-white/60 text-xs font-medium">Apply to</label>
            <div className="flex gap-2">
              {(["all", "current"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1.5 rounded text-xs border transition-colors ${scope === s ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  {s === "all" ? `All Slides (${slideCount})` : `Current Slide (${currentSlide})`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Cancel</button>
          <button
            onClick={apply}
            disabled={loading || !selected}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Applying…" : "Apply Preset"}
          </button>
        </div>
      </div>
    </div>
  )
}
