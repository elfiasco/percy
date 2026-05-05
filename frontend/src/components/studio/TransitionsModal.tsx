import { useState, useEffect } from "react"
import { fetchSlideTransitions, setSlideTransition, setBulkTransitions } from "../../lib/studioApi"

interface Props {
  docId: string
  slideCount: number
  currentSlide: number
  onClose: () => void
  onApplied?: () => void
}

const TRANSITIONS = [
  { id: "none",     label: "None",     icon: "⊘",  desc: "No animation" },
  { id: "fade",     label: "Fade",     icon: "◌",  desc: "Crossfade between slides" },
  { id: "slide",    label: "Slide",    icon: "→",  desc: "Slides in from the right" },
  { id: "push",     label: "Push",     icon: "⇒",  desc: "Pushes current slide out" },
  { id: "wipe",     label: "Wipe",     icon: "▷",  desc: "Wipes across the slide" },
  { id: "zoom",     label: "Zoom",     icon: "⊕",  desc: "Zooms into the next slide" },
  { id: "flip",     label: "Flip",     icon: "↻",  desc: "3D flip effect" },
  { id: "dissolve", label: "Dissolve", icon: "✦",  desc: "Pixel dissolve effect" },
]

const DURATION_PRESETS = [
  { label: "Fast", ms: 250 },
  { label: "Normal", ms: 500 },
  { label: "Slow", ms: 1000 },
  { label: "Very slow", ms: 2000 },
]

type SlideTransitions = Record<string, { transition: string; duration_ms: number }>

export default function TransitionsModal({ docId, slideCount, currentSlide, onClose, onApplied }: Props) {
  const [transitions, setTransitions]     = useState<SlideTransitions>({})
  const [loading, setLoading]             = useState(true)
  const [applying, setApplying]           = useState(false)
  const [bulkTransition, setBulkT]        = useState("none")
  const [bulkDuration, setBulkDuration]   = useState(500)
  const [perSlide, setPerSlide]           = useState(false)
  const [selectedSlides, setSelectedSlides] = useState<Set<number>>(new Set())

  useEffect(() => {
    fetchSlideTransitions(docId)
      .then((r) => { setTransitions(r.transitions); setLoading(false) })
      .catch(() => setLoading(false))
  }, [docId])

  const getTransition = (n: number) =>
    transitions[String(n)]?.transition ?? "none"
  const getDuration = (n: number) =>
    transitions[String(n)]?.duration_ms ?? 500

  const handleApplyBulk = async () => {
    setApplying(true)
    try {
      const slides = selectedSlides.size > 0 ? [...selectedSlides] : undefined
      await setBulkTransitions(docId, bulkTransition, bulkDuration, slides)
      // Refresh local state
      const r = await fetchSlideTransitions(docId)
      setTransitions(r.transitions)
      onApplied?.()
    } catch (e) { console.error("bulk transition failed:", e) }
    setApplying(false)
  }

  const handlePerSlideChange = async (n: number, transition: string, duration: number) => {
    try {
      await setSlideTransition(docId, n, transition, duration)
      setTransitions((prev) => {
        const next = { ...prev }
        if (transition === "none") {
          delete next[String(n)]
        } else {
          next[String(n)] = { transition, duration_ms: duration }
        }
        return next
      })
      onApplied?.()
    } catch (e) { console.error("transition set failed:", e) }
  }

  const toggleSlide = (n: number) => {
    setSelectedSlides((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n); else next.add(n)
      return next
    })
  }

  const slideNums = Array.from({ length: slideCount }, (_, i) => i + 1)

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-edge rounded-xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Slide Transitions</h2>
            <p className="text-[11px] text-muted mt-0.5">Set animation effects between slides</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">×</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* left column — bulk settings */}
          <div className="w-52 shrink-0 border-r border-edge flex flex-col p-4 gap-4 overflow-y-auto">
            <div>
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Transition</div>
              <div className="grid grid-cols-2 gap-1.5">
                {TRANSITIONS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setBulkT(t.id)}
                    title={t.desc}
                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded border text-[11px] transition-colors ${
                      bulkTransition === t.id
                        ? "border-accent bg-accent/20 text-accent-light"
                        : "border-edge bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    <span className="text-base leading-none">{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Duration</div>
              <div className="flex flex-col gap-1">
                {DURATION_PRESETS.map((d) => (
                  <button
                    key={d.ms}
                    onClick={() => setBulkDuration(d.ms)}
                    className={`flex justify-between items-center px-3 py-1.5 rounded text-[11px] border transition-colors ${
                      bulkDuration === d.ms
                        ? "border-accent bg-accent/20 text-accent-light"
                        : "border-edge bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    <span>{d.label}</span>
                    <span className="text-muted">{d.ms}ms</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] text-muted">Custom:</span>
                <input
                  type="number"
                  min={100} max={5000} step={100}
                  value={bulkDuration}
                  onChange={(e) => setBulkDuration(Number(e.target.value))}
                  className="w-20 text-[11px] bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent"
                />
                <span className="text-[10px] text-muted">ms</span>
              </div>
            </div>

            <div className="mt-auto">
              <div className="text-[11px] text-muted mb-2">
                {selectedSlides.size > 0
                  ? `Apply to ${selectedSlides.size} selected slide${selectedSlides.size !== 1 ? "s" : ""}`
                  : "Apply to all slides"}
              </div>
              <button
                onClick={handleApplyBulk}
                disabled={applying}
                className="w-full py-2 rounded bg-accent text-white text-xs font-semibold hover:bg-accent/80 transition-colors disabled:opacity-50"
              >
                {applying ? "Applying…" : "Apply"}
              </button>
              {selectedSlides.size > 0 && (
                <button
                  onClick={() => setSelectedSlides(new Set())}
                  className="w-full mt-1 py-1.5 rounded border border-edge text-xs text-muted hover:text-slate-300 hover:bg-white/5 transition-colors"
                >
                  Clear selection
                </button>
              )}
            </div>
          </div>

          {/* right column — per-slide list */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-2 border-b border-edge/50 sticky top-0 bg-surface z-10">
              <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">Per-slide</span>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={perSlide}
                  onChange={(e) => setPerSlide(e.target.checked)}
                  className="accent-indigo-500"
                />
                Edit individual
              </label>
            </div>
            {loading ? (
              <div className="p-6 text-xs text-muted text-center">Loading…</div>
            ) : (
              <div className="divide-y divide-edge/30">
                {slideNums.map((n) => {
                  const cur = getTransition(n)
                  const dur = getDuration(n)
                  const isSelected = selectedSlides.has(n)
                  const isCurrent = n === currentSlide
                  return (
                    <div
                      key={n}
                      onClick={() => { if (!perSlide) toggleSlide(n) }}
                      className={`flex items-center gap-3 px-4 py-2 transition-colors ${
                        !perSlide ? "cursor-pointer hover:bg-white/5" : ""
                      } ${isSelected ? "bg-accent/10" : ""} ${isCurrent ? "bg-white/5" : ""}`}
                    >
                      <div className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${
                        isSelected ? "bg-accent border-accent" : "border-edge"
                      }`}>
                        {isSelected && <span className="text-white text-[9px]">✓</span>}
                      </div>
                      <span className={`text-[11px] w-14 shrink-0 ${isCurrent ? "text-accent-light font-semibold" : "text-muted"}`}>
                        {isCurrent ? "► " : ""}Slide {n}
                      </span>
                      {perSlide ? (
                        <select
                          value={cur}
                          onChange={(e) => handlePerSlideChange(n, e.target.value, dur)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 text-[11px] bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent"
                        >
                          {TRANSITIONS.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`flex-1 text-[11px] ${cur === "none" ? "text-muted" : "text-slate-300"}`}>
                          {TRANSITIONS.find((t) => t.id === cur)?.label ?? cur}
                          {cur !== "none" && <span className="ml-2 text-[10px] text-muted">({dur}ms)</span>}
                        </span>
                      )}
                      {perSlide && cur !== "none" && (
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={100} max={5000} step={100}
                            value={dur}
                            onChange={(e) => handlePerSlideChange(n, cur, Number(e.target.value))}
                            onClick={(e) => e.stopPropagation()}
                            className="w-16 text-[10px] bg-base border border-edge rounded px-1 py-0.5 text-slate-200 focus:outline-none focus:border-accent"
                          />
                          <span className="text-[10px] text-muted">ms</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-edge shrink-0 flex items-center justify-between text-[11px] text-muted">
          <span>
            {Object.keys(transitions).length} slide{Object.keys(transitions).length !== 1 ? "s" : ""} with transitions
          </span>
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-edge hover:bg-white/5 transition-colors text-slate-300">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
