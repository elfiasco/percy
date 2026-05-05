import { useState, useEffect } from "react"
import { fetchExportChecklist } from "../../lib/studioApi"
import type { ChecklistItem } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const statusIcon = (s: ChecklistItem["status"]) =>
  s === "pass" ? "✓" : s === "warn" ? "⚠" : "✗"
const statusColor = (s: ChecklistItem["status"]) =>
  s === "pass" ? "text-green-400" : s === "warn" ? "text-yellow-400" : "text-red-400"
const statusBg = (s: ChecklistItem["status"]) =>
  s === "pass" ? "bg-green-400/8 border-green-400/20" : s === "warn" ? "bg-yellow-400/8 border-yellow-400/20" : "bg-red-400/8 border-red-400/20"

export default function ExportChecklistModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ overall: string; fails: number; warns: number; items: ChecklistItem[] } | null>(null)
  const [error, setError]     = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      setData(await fetchExportChecklist(docId))
    } catch {
      setError("Failed to run export checklist")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const overallColor = data?.overall === "ready" ? "text-green-400" : data?.overall === "issues" ? "text-red-400" : "text-yellow-400"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Export Checklist</h2>
            <p className="text-white/40 text-xs mt-0.5">Pre-flight checks before exporting your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-8 justify-center">
              <div className="animate-spin text-base">✦</div>
              <span>Running checks…</span>
            </div>
          )}

          {data && !loading && (
            <>
              <div className={`text-sm font-medium ${overallColor} flex items-center gap-2`}>
                <span className="capitalize">{data.overall === "ready" ? "Ready to export" : data.overall === "issues" ? "Issues must be resolved" : "Minor warnings"}</span>
                {(data.fails > 0 || data.warns > 0) && (
                  <span className="text-white/30 text-xs font-normal">
                    {data.fails > 0 && `${data.fails} fail${data.fails !== 1 ? "s" : ""}`}
                    {data.fails > 0 && data.warns > 0 && " · "}
                    {data.warns > 0 && `${data.warns} warning${data.warns !== 1 ? "s" : ""}`}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {data.items.map((item, i) => (
                  <div key={i} className={`border rounded-lg px-3 py-2.5 flex items-start gap-3 ${statusBg(item.status)}`}>
                    <span className={`${statusColor(item.status)} text-sm shrink-0 w-4 text-center`}>{statusIcon(item.status)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white/70 text-xs font-medium">{item.check}</p>
                      <p className="text-white/40 text-[10px] mt-0.5 leading-relaxed">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Checking…" : "Re-run"}
          </button>
        </div>
      </div>
    </div>
  )
}
