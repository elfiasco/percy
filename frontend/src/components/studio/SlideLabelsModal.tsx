import { useState, useEffect } from "react"
import { fetchAllLabels, setSlideLabel, removeSlideLabel } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const PRESET_LABELS = ["Important", "Review", "Draft", "Archived", "Action Required", "Reference"]
const LABEL_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"]

export default function SlideLabelsModal({ docId, slideCount, currentSlide, onClose, onJumpToSlide }: Props) {
  const [labels, setLabels]       = useState<Array<{ label: string; slides: number[] }>>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState("")
  const [addSlideN, setAddSlideN] = useState(currentSlide)
  const [newLabel, setNewLabel]   = useState("")
  const [labelColor, setLabelColor] = useState(LABEL_COLORS[0])
  const [adding, setAdding]       = useState(false)
  const [expanded, setExpanded]   = useState<string | null>(null)

  const reload = async () => {
    try {
      const r = await fetchAllLabels(docId)
      setLabels(r.labels)
    } catch {
      setError("Failed to load labels")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const addLabel = async (label: string) => {
    if (!label.trim()) return
    setAdding(true)
    try {
      await setSlideLabel(docId, addSlideN, label.trim(), labelColor)
      setNewLabel("")
      await reload()
    } catch {
      setError("Failed to add label")
    } finally {
      setAdding(false)
    }
  }

  const deleteLabel = async (slideN: number, label: string) => {
    try {
      await removeSlideLabel(docId, slideN, label)
      await reload()
    } catch {
      setError("Failed to remove label")
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Slide Labels</h2>
            <p className="text-white/40 text-xs mt-0.5">Custom categories and tags for organizing slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {/* Add label */}
          <div className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-3">
            <div className="text-white/60 text-xs font-medium">Add label to slide</div>
            <div className="flex items-center gap-2">
              <label className="text-white/40 text-xs shrink-0">Slide:</label>
              <input
                type="number" min={1} max={slideCount} value={addSlideN}
                onChange={(e) => setAddSlideN(Math.max(1, Math.min(slideCount, parseInt(e.target.value) || 1)))}
                className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_LABELS.map((pl) => (
                <button
                  key={pl}
                  onClick={() => addLabel(pl)}
                  disabled={adding}
                  className="px-2 py-0.5 rounded text-[10px] bg-white/5 border border-white/10 text-white/50 hover:text-white/80 transition-colors disabled:opacity-50"
                >
                  + {pl}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLabel(newLabel)}
                placeholder="Custom label…"
                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-white/25 focus:outline-none focus:border-accent/50"
              />
              <div className="flex gap-1">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setLabelColor(c)}
                    className={`w-4 h-4 rounded-full border-2 transition-all ${labelColor === c ? "border-white/60 scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button
                onClick={() => addLabel(newLabel)}
                disabled={adding || !newLabel.trim()}
                className="text-xs px-3 py-1 rounded bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          {/* All labels */}
          {loading ? (
            <div className="text-white/30 text-xs text-center py-4">Loading labels…</div>
          ) : labels.length === 0 ? (
            <div className="text-white/30 text-xs text-center py-4">No labels added yet.</div>
          ) : (
            <div className="space-y-1.5">
              {labels.map((l) => (
                <div key={l.label} className="rounded-lg border border-white/10 overflow-hidden">
                  <button
                    className="w-full flex items-center gap-3 px-3 py-2 bg-white/3 hover:bg-white/6 text-left"
                    onClick={() => setExpanded(expanded === l.label ? null : l.label)}
                  >
                    <span className="text-white/70 text-xs flex-1">{l.label}</span>
                    <span className="text-white/30 text-xs">{l.slides.length} slide{l.slides.length !== 1 ? "s" : ""}</span>
                    <span className="text-white/25 text-xs ml-1">{expanded === l.label ? "▲" : "▼"}</span>
                  </button>
                  {expanded === l.label && (
                    <div className="px-3 py-2 border-t border-white/8 flex flex-wrap gap-1.5">
                      {l.slides.map((n) => (
                        <div key={n} className="flex items-center gap-1 bg-white/5 rounded px-2 py-0.5">
                          <button
                            onClick={() => { onJumpToSlide(n); onClose() }}
                            className="text-xs text-accent/60 hover:text-accent transition-colors"
                          >
                            Slide {n}
                          </button>
                          <button
                            onClick={() => deleteLabel(n, l.label)}
                            className="text-white/20 hover:text-red-400 text-[10px] transition-colors"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
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
