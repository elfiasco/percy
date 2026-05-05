import { useState, useEffect } from "react"
import { fetchColorPalette } from "../../lib/studioApi"
import type { PaletteColor } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r}, ${g}, ${b}`
}

export default function ColorPaletteModal({ docId, onClose }: Props) {
  const [loading, setLoading]       = useState(true)
  const [data, setData]             = useState<{ colors: PaletteColor[]; total_unique: number; slide_count: number } | null>(null)
  const [error, setError]           = useState("")
  const [filter, setFilter]         = useState<"all" | "text" | "background" | "fill">("all")
  const [copied, setCopied]         = useState<string | null>(null)

  useEffect(() => {
    fetchColorPalette(docId)
      .then(setData)
      .catch(() => setError("Failed to extract color palette"))
      .finally(() => setLoading(false))
  }, [docId])

  const copy = (hex: string) => {
    navigator.clipboard.writeText(hex).catch(() => {})
    setCopied(hex)
    setTimeout(() => setCopied(null), 1500)
  }

  const filtered = data?.colors
    ? (filter === "all" ? data.colors : data.colors.filter((c) => c.roles.includes(filter)))
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[580px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Color Palette</h2>
            <p className="text-white/40 text-xs mt-0.5">All unique colors used across the deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting colors…</p>
            </div>
          ) : data && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white/40 text-xs">{data.total_unique} unique color{data.total_unique !== 1 ? "s" : ""}</span>
                <div className="ml-auto flex gap-1.5">
                  {(["all", "text", "background", "fill"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-2 py-0.5 rounded text-[10px] border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/35 hover:text-white/60"}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-white/30">
                  <p className="text-sm">No colors found for this filter.</p>
                </div>
              ) : (
                <>
                  {/* Swatch grid */}
                  <div className="grid grid-cols-8 gap-2">
                    {filtered.map((c) => (
                      <button
                        key={c.hex}
                        onClick={() => copy(c.hex)}
                        className="group relative"
                        title={`${c.hex} — click to copy`}
                      >
                        <div
                          className="w-full aspect-square rounded-lg border border-white/10 group-hover:border-white/30 transition-colors"
                          style={{ backgroundColor: c.hex }}
                        />
                        {copied === c.hex && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                            <span className="text-white text-[10px]">✓</span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Table */}
                  <div className="space-y-1">
                    {filtered.slice(0, 20).map((c) => (
                      <div key={c.hex} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded px-3 py-1.5">
                        <div
                          className="w-6 h-6 rounded shrink-0 border border-white/10"
                          style={{ backgroundColor: c.hex }}
                        />
                        <button
                          onClick={() => copy(c.hex)}
                          className="text-white/60 text-xs font-mono hover:text-white/90 transition-colors"
                        >
                          {copied === c.hex ? "Copied!" : c.hex}
                        </button>
                        <span className="text-white/25 text-[10px] flex-1">{hexToRgb(c.hex)}</span>
                        <div className="flex gap-1">
                          {c.roles.map((r) => (
                            <span key={r} className="text-white/25 text-[10px] capitalize">{r}</span>
                          ))}
                        </div>
                        <span className="text-white/25 text-[10px] shrink-0">{c.count}×</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
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
