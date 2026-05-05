import { useState } from "react"
import type { ThemePalette } from "../../lib/studioApi"
import { generateThemePalette, replaceColor, fetchColorPalette } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onApplied?: () => void
}

const STYLES = [
  { id: "professional", label: "Professional", emoji: "💼", desc: "Corporate blues & grays" },
  { id: "vibrant",      label: "Vibrant",      emoji: "⚡", desc: "Bold, saturated colors" },
  { id: "pastel",       label: "Pastel",        emoji: "🌸", desc: "Soft, gentle tones" },
  { id: "dark",         label: "Dark",          emoji: "🌙", desc: "Dramatic dark theme" },
  { id: "monochrome",   label: "Monochrome",    emoji: "◑",  desc: "Elegant single-hue" },
] as const

type StyleId = typeof STYLES[number]["id"]

const COLOR_LABELS: Record<string, string> = {
  primary:    "Primary",
  secondary:  "Secondary",
  accent:     "Accent",
  background: "Background",
  text:       "Text",
  muted:      "Muted",
}

export default function ThemeGeneratorModal({ docId, onClose, onApplied }: Props) {
  const [style, setStyle]           = useState<StyleId>("professional")
  const [seedColor, setSeedColor]   = useState("")
  const [palette, setPalette]       = useState<ThemePalette | null>(null)
  const [generating, setGenerating] = useState(false)
  const [applying, setApplying]     = useState(false)
  const [existingColors, setExistingColors] = useState<string[]>([])
  const [mapping, setMapping]       = useState<Record<string, string>>({})
  const [step, setStep]             = useState<"generate" | "map" | "done">("generate")
  const [applyResults, setApplyResults] = useState<{ key: string; replaced: number }[]>([])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const p = await generateThemePalette(docId, seedColor || undefined, style)
      setPalette(p)
      // Also fetch existing colors for the mapping step
      const r = await fetchColorPalette(docId)
      setExistingColors(r.colors.slice(0, 12))
      // Pre-populate mapping: map first existing color to primary, etc.
      const colorKeys = Object.keys(p.colors)
      const initial: Record<string, string> = {}
      r.colors.slice(0, colorKeys.length).forEach((c, i) => {
        initial[colorKeys[i]] = c
      })
      setMapping(initial)
      setStep("map")
    } catch (e) { console.error("theme gen failed:", e) }
    setGenerating(false)
  }

  const handleApply = async () => {
    if (!palette) return
    setApplying(true)
    const results: { key: string; replaced: number }[] = []
    for (const [role, oldColor] of Object.entries(mapping)) {
      if (!oldColor || !palette.colors[role as keyof typeof palette.colors]) continue
      const newColor = palette.colors[role as keyof typeof palette.colors]
      if (oldColor.toLowerCase() === newColor.toLowerCase()) continue
      try {
        const r = await replaceColor(docId, oldColor, newColor, 15)
        results.push({ key: role, replaced: r.replaced })
      } catch (e) { console.error(`replace ${role} failed:`, e) }
    }
    setApplyResults(results)
    setStep("done")
    setApplying(false)
    onApplied?.()
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-edge rounded-xl shadow-2xl w-[620px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">AI Theme Generator</h2>
            <p className="text-[11px] text-muted mt-0.5">Generate and apply a harmonious color palette</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none">×</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {step === "generate" && (
            <div className="space-y-5">
              {/* style selector */}
              <div>
                <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Style</div>
                <div className="grid grid-cols-5 gap-2">
                  {STYLES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setStyle(s.id)}
                      className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded border text-[11px] transition-colors ${
                        style === s.id
                          ? "border-accent bg-accent/20 text-accent-light"
                          : "border-edge bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      <span className="text-xl">{s.emoji}</span>
                      <span className="font-semibold">{s.label}</span>
                      <span className="text-[9px] text-muted text-center leading-tight">{s.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* seed color */}
              <div>
                <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Seed Color (optional)</div>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={seedColor || "#4472C4"}
                    onChange={(e) => setSeedColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border border-edge bg-transparent"
                  />
                  <input
                    type="text"
                    value={seedColor}
                    onChange={(e) => setSeedColor(e.target.value)}
                    placeholder="#4472C4 — or leave blank to auto-generate"
                    className="flex-1 text-xs bg-base border border-edge rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-accent font-mono"
                  />
                  {seedColor && (
                    <button onClick={() => setSeedColor("")} className="text-muted hover:text-slate-200 text-xs">
                      ×
                    </button>
                  )}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full py-3 rounded bg-accent text-white text-sm font-semibold hover:bg-accent/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {generating && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {generating ? "Generating…" : "✨ Generate Palette"}
              </button>
            </div>
          )}

          {step === "map" && palette && (
            <div className="space-y-5">
              {/* palette preview */}
              <div>
                <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Generated Palette — {palette.name}</div>
                <p className="text-[11px] text-muted mb-3">{palette.description}</p>
                <div className="grid grid-cols-6 gap-2">
                  {Object.entries(palette.colors).map(([role, hex]) => (
                    <div key={role} className="flex flex-col gap-1">
                      <div
                        className="w-full h-10 rounded border border-edge/50 shadow-inner"
                        style={{ background: hex }}
                      />
                      <div className="text-[9px] text-center text-muted">{COLOR_LABELS[role] ?? role}</div>
                      <div className="text-[9px] text-center font-mono text-slate-400">{hex}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* mapping */}
              <div>
                <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">Replace Existing Colors</div>
                <p className="text-[11px] text-muted mb-3">
                  Map your existing deck colors to the new palette. Choose which old color each role replaces.
                </p>
                <div className="space-y-2">
                  {Object.entries(palette.colors).map(([role, newHex]) => (
                    <div key={role} className="flex items-center gap-3 py-1.5">
                      <div className="w-5 h-5 rounded border border-edge/50 shrink-0" style={{ background: newHex }} />
                      <span className="text-xs text-slate-300 w-24 shrink-0">{COLOR_LABELS[role] ?? role}</span>
                      <span className="text-[10px] font-mono text-muted">{newHex}</span>
                      <span className="text-muted text-sm mx-1">←</span>
                      <select
                        value={mapping[role] ?? ""}
                        onChange={(e) => setMapping((m) => ({ ...m, [role]: e.target.value }))}
                        className="flex-1 text-[11px] bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent font-mono"
                      >
                        <option value="">(skip — don't replace)</option>
                        {existingColors.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      {mapping[role] && (
                        <div className="w-5 h-5 rounded border border-edge/50 shrink-0" style={{ background: mapping[role] }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep("generate")}
                  className="flex-1 py-2 rounded border border-edge text-xs text-muted hover:text-slate-200 hover:bg-white/5 transition-colors"
                >
                  ← Regenerate
                </button>
                <button
                  onClick={handleApply}
                  disabled={applying || Object.values(mapping).every((v) => !v)}
                  className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {applying && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {applying ? "Applying…" : "Apply Theme"}
                </button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-8 space-y-4">
              <div className="text-4xl">🎨</div>
              <div className="text-sm font-semibold text-slate-100">Theme Applied!</div>
              {applyResults.length > 0 ? (
                <div className="text-[11px] text-muted space-y-1">
                  {applyResults.map((r) => (
                    <div key={r.key}>
                      {COLOR_LABELS[r.key] ?? r.key}: {r.replaced} replacement{r.replaced !== 1 ? "s" : ""}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted">No colors were replaced (mappings were empty or already matched).</p>
              )}
              <button
                onClick={() => { setPalette(null); setStep("generate"); setApplyResults([]) }}
                className="px-4 py-2 rounded border border-edge text-xs text-muted hover:text-slate-200 hover:bg-white/5 transition-colors"
              >
                Generate Another
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-edge shrink-0 flex items-center justify-end">
          <button onClick={onClose} className="px-4 py-1.5 rounded border border-edge text-xs text-slate-300 hover:bg-white/5 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
