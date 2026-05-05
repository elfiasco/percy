import { useState } from "react"
import { fetchAgendaSync } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onApplied?: (slideN: number) => void
}

export default function AgendaSyncModal({ docId, onClose, onApplied }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState<{ agenda_found: boolean; agenda_slide: number | null; new_items: string[]; applied: boolean } | null>(null)
  const [error, setError]     = useState("")

  const run = async (apply = false) => {
    setLoading(true)
    setError("")
    try {
      const r = await fetchAgendaSync(docId, apply)
      setData(r)
      if (apply && r.applied && r.agenda_slide !== null) {
        onApplied?.(r.agenda_slide)
      }
    } catch {
      setError("Failed to sync agenda")
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
            <h2 className="text-white font-semibold text-sm">Agenda Sync</h2>
            <p className="text-white/40 text-xs mt-0.5">AI updates the agenda to match your current sections</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs py-4">
              <div className="animate-spin text-base">✦</div>
              <span>Syncing agenda…</span>
            </div>
          ) : data ? (
            !data.agenda_found ? (
              <div className="text-white/40 text-xs text-center py-4">No agenda or table of contents slide found.</div>
            ) : (
              <div className="space-y-3">
                <p className="text-white/40 text-xs">Suggested agenda items for Slide {data.agenda_slide}:</p>
                <div className="bg-white/3 border border-white/8 rounded-lg px-3 py-3 space-y-1">
                  {data.new_items.map((item, i) => (
                    <p key={i} className="text-white/65 text-sm">• {item}</p>
                  ))}
                </div>
                {data.applied && <p className="text-green-400/60 text-xs">Applied to agenda slide</p>}
              </div>
            )
          ) : (
            <p className="text-white/35 text-xs text-center py-4">AI will read your section headings and update the agenda slide.</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <div className="flex gap-2">
            {data?.agenda_found && !data.applied && (
              <button
                onClick={() => run(true)}
                disabled={loading}
                className="text-sm px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-40 transition-colors"
              >
                Apply to Slide
              </button>
            )}
            <button
              onClick={() => run(false)}
              disabled={loading}
              className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
            >
              {loading ? "Syncing…" : data ? "Re-sync" : "Preview"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
