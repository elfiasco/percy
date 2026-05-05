import { useState } from "react"
import { extractActionItems } from "../../lib/studioApi"
import type { ActionItem } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onJumpToSlide: (n: number) => void
}

const PRIORITY_COLOR: Record<string, string> = {
  high:   "bg-red-400/15 border-red-400/30 text-red-300",
  medium: "bg-yellow-400/15 border-yellow-400/30 text-yellow-300",
  low:    "bg-white/5 border-white/15 text-white/50",
}

const PRIORITY_DOT: Record<string, string> = {
  high:   "bg-red-400",
  medium: "bg-yellow-400",
  low:    "bg-white/30",
}

export default function ActionItemsModal({ docId, onClose, onJumpToSlide }: Props) {
  const [loading, setLoading]   = useState(false)
  const [items, setItems]       = useState<ActionItem[] | null>(null)
  const [meta, setMeta]         = useState<{ total: number; slide_count: number; high_priority: number } | null>(null)
  const [filter, setFilter]     = useState<"all" | "high" | "medium" | "low">("all")
  const [error, setError]       = useState("")
  const [copied, setCopied]     = useState(false)

  const handleExtract = async () => {
    setLoading(true)
    setError("")
    setItems(null)
    setMeta(null)
    try {
      const r = await extractActionItems(docId)
      setItems(r.items)
      setMeta({ total: r.total, slide_count: r.slide_count, high_priority: r.high_priority })
    } catch {
      setError("Failed to extract action items")
    } finally {
      setLoading(false)
    }
  }

  const filteredItems = items?.filter((i) => filter === "all" || i.priority === filter) ?? []

  const copyToClipboard = () => {
    if (!items) return
    const text = items.map((i) =>
      `[ ] ${i.action}${i.owner ? ` — @${i.owner}` : ""}${i.deadline ? ` (due: ${i.deadline})` : ""} [Slide ${i.slide_n}]`
    ).join("\n")
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Action Item Extractor</h2>
            <p className="text-white/40 text-xs mt-0.5">Find tasks, owners, and deadlines across all slides</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!items && (
            <div className="space-y-3">
              <p className="text-white/50 text-sm">
                Claude will scan your slides for action items, tasks, follow-ups, and commitments —
                extracting owners and deadlines when mentioned.
              </p>
              <button
                onClick={handleExtract}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-40 transition-colors"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">✦</span> Scanning slides…
                  </span>
                ) : "Extract Action Items"}
              </button>
            </div>
          )}

          {items !== null && (
            <>
              {/* summary + controls */}
              <div className="flex items-center gap-3">
                <div className="flex-1 flex items-center gap-2 flex-wrap">
                  {meta && (
                    <>
                      <span className="text-white/40 text-xs">{meta.total} item{meta.total !== 1 ? "s" : ""} found</span>
                      {meta.high_priority > 0 && (
                        <span className="text-red-300 text-xs bg-red-400/10 border border-red-400/20 rounded px-1.5 py-0.5">
                          {meta.high_priority} high priority
                        </span>
                      )}
                    </>
                  )}
                </div>
                <button
                  onClick={copyToClipboard}
                  className="text-xs px-2.5 py-1 rounded border border-white/15 text-white/50 hover:text-white hover:bg-white/8 transition-colors shrink-0"
                >
                  {copied ? "✓ Copied" : "Copy list"}
                </button>
                <button
                  onClick={() => { setItems(null); setMeta(null) }}
                  className="text-xs px-2.5 py-1 rounded border border-white/15 text-white/40 hover:text-white/70 hover:bg-white/8 transition-colors shrink-0"
                >
                  Re-scan
                </button>
              </div>

              {/* priority filter */}
              <div className="flex gap-1.5">
                {(["all", "high", "medium", "low"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2.5 py-1 rounded text-xs border transition-colors capitalize ${filter === f ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"}`}
                  >
                    {f}
                    {f !== "all" && items && (
                      <span className="ml-1 text-white/30">
                        ({items.filter((i) => i.priority === f).length})
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {filteredItems.length === 0 ? (
                <div className="text-center py-8 text-white/30 text-sm">
                  {items.length === 0 ? "No action items found in this deck" : `No ${filter} priority items`}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredItems.map((item, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border px-4 py-3 ${PRIORITY_COLOR[item.priority] ?? "bg-white/5 border-white/10"}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${PRIORITY_DOT[item.priority] ?? "bg-white/20"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm leading-relaxed">{item.action}</p>
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            {item.owner && (
                              <span className="text-white/50 text-xs">👤 {item.owner}</span>
                            )}
                            {item.deadline && (
                              <span className="text-white/50 text-xs">📅 {item.deadline}</span>
                            )}
                            <button
                              onClick={() => { onJumpToSlide(item.slide_n); onClose() }}
                              className="text-white/30 text-xs hover:text-white/60 transition-colors"
                            >
                              Slide {item.slide_n} ↗
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
