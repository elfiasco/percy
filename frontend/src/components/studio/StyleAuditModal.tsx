import { useState, useEffect } from "react"
import { fetchStyleAudit } from "../../lib/studioApi"
import type { StyleAuditResult } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

type Tab = "fonts" | "sizes" | "fill" | "text"

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-4 h-4 rounded border border-white/20 shrink-0"
      style={{ backgroundColor: color }}
    />
  )
}

function Bar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
        <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-white/30 text-[10px] font-mono w-8 text-right shrink-0">{count}</span>
    </div>
  )
}

export default function StyleAuditModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [audit, setAudit]     = useState<StyleAuditResult | null>(null)
  const [error, setError]     = useState("")
  const [tab, setTab]         = useState<Tab>("fonts")

  useEffect(() => {
    setLoading(true)
    fetchStyleAudit(docId)
      .then((r) => setAudit(r))
      .catch(() => setError("Failed to load style audit"))
      .finally(() => setLoading(false))
  }, [docId])

  const TABS: { key: Tab; label: string; badge: number | null }[] = audit
    ? [
        { key: "fonts",  label: "Fonts",       badge: audit.unique_fonts },
        { key: "sizes",  label: "Font Sizes",   badge: audit.unique_sizes },
        { key: "fill",   label: "Fill Colors",  badge: audit.unique_fill_colors },
        { key: "text",   label: "Text Colors",  badge: audit.unique_text_colors },
      ]
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Style Audit</h2>
            <p className="text-white/40 text-xs mt-0.5">All fonts, sizes, and colors used in the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Scanning styles…</p>
            </div>
          ) : audit && (
            <>
              {/* summary chips */}
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Fonts", value: audit.unique_fonts,       warn: audit.unique_fonts > 3 },
                  { label: "Sizes", value: audit.unique_sizes,       warn: audit.unique_sizes > 6 },
                  { label: "Fill colors", value: audit.unique_fill_colors, warn: false },
                  { label: "Text colors", value: audit.unique_text_colors, warn: audit.unique_text_colors > 5 },
                ].map((c) => (
                  <div
                    key={c.label}
                    className={`px-3 py-1.5 rounded-lg border text-xs ${c.warn ? "bg-yellow-400/10 border-yellow-400/20 text-yellow-300" : "bg-white/5 border-white/10 text-white/60"}`}
                  >
                    <span className="font-bold text-sm">{c.value}</span> {c.label}
                    {c.warn && <span className="ml-1.5 text-yellow-400/60">⚠</span>}
                  </div>
                ))}
              </div>

              {/* tabs */}
              <div className="flex gap-1">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-3 py-1.5 rounded text-xs border transition-colors ${tab === t.key ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                  >
                    {t.label}
                    {t.badge !== null && <span className="ml-1.5 text-[10px] opacity-60">({t.badge})</span>}
                  </button>
                ))}
              </div>

              {/* tab content */}
              <div className="space-y-1.5">
                {tab === "fonts" && audit.font_names.map((f) => (
                  <div key={f.name} className="flex items-center gap-3 rounded px-3 py-2 bg-white/3 hover:bg-white/5">
                    <span className="text-white/80 text-sm flex-1 truncate" style={{ fontFamily: f.name }}>{f.name}</span>
                    <Bar count={f.count} max={audit.font_names[0]?.count ?? 1} />
                  </div>
                ))}

                {tab === "sizes" && audit.font_sizes.map((f) => (
                  <div key={f.size} className="flex items-center gap-3 rounded px-3 py-2 bg-white/3 hover:bg-white/5">
                    <span className="text-white/80 text-sm flex-1 font-mono">{f.size}pt</span>
                    <Bar count={f.count} max={audit.font_sizes[0]?.count ?? 1} />
                  </div>
                ))}

                {tab === "fill" && (
                  audit.fill_colors.length === 0
                    ? <p className="text-white/30 text-xs text-center py-6">No solid fill colors found</p>
                    : audit.fill_colors.map((f) => (
                        <div key={f.color} className="flex items-center gap-3 rounded px-3 py-2 bg-white/3 hover:bg-white/5">
                          <ColorSwatch color={f.color} />
                          <span className="text-white/60 text-xs font-mono flex-1">{f.color}</span>
                          <Bar count={f.count} max={audit.fill_colors[0]?.count ?? 1} />
                        </div>
                      ))
                )}

                {tab === "text" && (
                  audit.text_colors.length === 0
                    ? <p className="text-white/30 text-xs text-center py-6">No explicit text colors found</p>
                    : audit.text_colors.map((f) => (
                        <div key={f.color} className="flex items-center gap-3 rounded px-3 py-2 bg-white/3 hover:bg-white/5">
                          <ColorSwatch color={f.color} />
                          <span className="text-white/60 text-xs font-mono flex-1">{f.color}</span>
                          <Bar count={f.count} max={audit.text_colors[0]?.count ?? 1} />
                        </div>
                      ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
