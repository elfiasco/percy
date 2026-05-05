import { useState } from "react"
import { manageProgressBars } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  onClose: () => void
  onApplied: () => void
}

const PRESET_COLORS = [
  { label: "Indigo", value: "#6366F1" },
  { label: "Purple", value: "#A855F7" },
  { label: "Blue",   value: "#3B82F6" },
  { label: "Cyan",   value: "#06B6D4" },
  { label: "Green",  value: "#22C55E" },
  { label: "Amber",  value: "#F59E0B" },
  { label: "Red",    value: "#EF4444" },
  { label: "White",  value: "#FFFFFF" },
]

export default function ProgressBarModal({ docId, slideCount, onClose, onApplied }: Props) {
  const [position, setPosition]   = useState<"bottom" | "top">("bottom")
  const [color, setColor]         = useState("#6366F1")
  const [heightPt, setHeightPt]   = useState(4)
  const [loading, setLoading]     = useState(false)
  const [removing, setRemoving]   = useState(false)
  const [error, setError]         = useState("")
  const [success, setSuccess]     = useState("")

  const apply = async (remove = false) => {
    if (remove) setRemoving(true)
    else setLoading(true)
    setError("")
    setSuccess("")
    try {
      const r = await manageProgressBars(docId, position, color, heightPt, remove)
      setSuccess(
        remove
          ? `Removed progress bars from ${r.affected_slides.length} slide${r.affected_slides.length !== 1 ? "s" : ""}`
          : `Added progress bar to ${r.affected_slides.length} slide${r.affected_slides.length !== 1 ? "s" : ""}`
      )
      onApplied()
    } catch {
      setError("Operation failed")
    } finally {
      setLoading(false)
      setRemoving(false)
    }
  }

  // Mini preview — show bar at correct position
  const previewH = 60
  const barPx = Math.max(1, Math.round(heightPt * 0.8))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[440px] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Progress Bar</h2>
            <p className="text-white/40 text-xs mt-0.5">Add a reading-progress bar to every slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}
          {success && <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">{success}</div>}

          {/* position */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Position</label>
            <div className="flex gap-2">
              {(["top", "bottom"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPosition(p)}
                  className={`flex-1 py-2 rounded text-xs border transition-colors capitalize ${position === p ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  {p}
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
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  title={c.label}
                  className={`w-6 h-6 rounded border-2 transition-all ${color === c.value ? "border-white scale-110" : "border-transparent hover:border-white/40"}`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border border-white/20"
                title="Custom color"
              />
            </div>
          </div>

          {/* height */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Thickness: {heightPt}pt</label>
            <input
              type="range" min={2} max={12} step={1} value={heightPt}
              onChange={(e) => setHeightPt(Number(e.target.value))}
              className="w-full accent-accent"
            />
          </div>

          {/* preview */}
          <div className="relative bg-black/30 border border-white/10 rounded-lg overflow-hidden" style={{ height: previewH }}>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-white/20 text-xs">Slide {Math.ceil(slideCount / 2)} of {slideCount}</span>
            </div>
            <div
              className="absolute left-0 right-0"
              style={{
                [position === "top" ? "top" : "bottom"]: 0,
                height: barPx,
                width: "50%",
                backgroundColor: color,
              }}
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between items-center">
          <button
            onClick={() => apply(true)}
            disabled={removing}
            className="text-xs text-red-400/60 hover:text-red-400 px-3 py-1.5 rounded hover:bg-red-400/10 transition-colors disabled:opacity-40"
          >
            {removing ? "Removing…" : "Remove Bars"}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Cancel</button>
            <button
              onClick={() => apply(false)}
              disabled={loading}
              className="text-sm px-4 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
            >
              {loading ? "Applying…" : "Add to All Slides"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
