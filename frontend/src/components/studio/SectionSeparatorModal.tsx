import { useState } from "react"
import { insertSectionSeparator } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onCreated: (newN: number, count: number) => void
}

type Style = "gradient" | "solid" | "minimal"

const PRESET_COLORS = [
  "#6366F1", "#8B5CF6", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#0F172A",
]

export default function SectionSeparatorModal({ docId, slideCount, currentSlide, onClose, onCreated }: Props) {
  const [title, setTitle]     = useState("")
  const [subtitle, setSubtitle] = useState("")
  const [afterN, setAfterN]   = useState(currentSlide)
  const [style, setStyle]     = useState<Style>("gradient")
  const [color, setColor]     = useState("#6366F1")
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState("")

  const insert = async () => {
    if (!title.trim()) { setError("Section title is required"); return }
    setLoading(true)
    setError("")
    try {
      const r = await insertSectionSeparator(docId, title.trim(), afterN, subtitle.trim(), style, color)
      onCreated(r.new_slide_n, r.slide_count)
      onClose()
    } catch {
      setError("Failed to insert section separator")
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Insert Section Separator</h2>
            <p className="text-white/40 text-xs mt-0.5">Styled divider slide between presentation sections</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {/* title + subtitle */}
          <div className="space-y-2">
            <div>
              <label className="text-white/60 text-xs font-medium block mb-1">Section Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Part 2: Strategy"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="text-white/60 text-xs font-medium block mb-1">Subtitle (optional)</label>
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Brief section description"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>

          {/* position */}
          <div className="space-y-1.5">
            <label className="text-white/60 text-xs font-medium">Insert After Slide</label>
            <div className="flex items-center gap-2">
              <input
                type="range" min={0} max={slideCount} value={afterN}
                onChange={(e) => setAfterN(Number(e.target.value))}
                className="flex-1 accent-accent"
              />
              <span className="text-white/60 text-xs font-mono w-16 text-right">
                {afterN === 0 ? "Start" : `After ${afterN}`}
              </span>
            </div>
          </div>

          {/* style */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Style</label>
            <div className="flex gap-2">
              {(["gradient", "solid", "minimal"] as Style[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={`flex-1 py-1.5 rounded text-xs border transition-colors capitalize ${style === s ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* color */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Color</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-lg border-2 transition-all ${color === c ? "border-white scale-110" : "border-transparent hover:border-white/40"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border border-white/20"
              />
            </div>
          </div>

          {/* preview */}
          <div
            className="relative rounded-lg overflow-hidden h-16 flex items-center justify-center"
            style={{ backgroundColor: color }}
          >
            <div className="text-center">
              <div className="text-white font-bold text-sm">{title || "Section Title"}</div>
              {subtitle && <div className="text-white/70 text-xs mt-0.5">{subtitle}</div>}
            </div>
            <div className="absolute bottom-1 left-3 w-8 h-0.5 bg-white/50 rounded" />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Cancel</button>
          <button
            onClick={insert}
            disabled={loading || !title.trim()}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Inserting…" : "Insert Separator"}
          </button>
        </div>
      </div>
    </div>
  )
}
