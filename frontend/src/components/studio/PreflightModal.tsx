import { useState, useEffect } from "react"
import { fetchPreflight } from "../../lib/studioApi"
import type { PreflightCheck } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const STATUS_META = {
  pass: { icon: "✓", color: "text-green-400",  bg: "bg-green-400/10 border-green-400/20" },
  warn: { icon: "⚠", color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/20" },
  fail: { icon: "✕", color: "text-red-400",    bg: "bg-red-400/10 border-red-400/20" },
}

const OVERALL_META = {
  ready:   { label: "Ready to Present",    color: "text-green-400",  icon: "✓" },
  warning: { label: "Minor Issues Found",  color: "text-yellow-400", icon: "⚠" },
  issues:  { label: "Issues to Address",   color: "text-red-400",    icon: "✕" },
}

export default function PreflightModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState<{ checks: PreflightCheck[]; passed: number; warned: number; failed: number; overall: string; slide_count: number } | null>(null)
  const [error, setError]     = useState("")

  const load = () => {
    setLoading(true)
    fetchPreflight(docId)
      .then((r) => setData(r))
      .catch(() => setError("Failed to run pre-flight check"))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const overall = data ? (OVERALL_META[data.overall as keyof typeof OVERALL_META] ?? OVERALL_META["warning"]) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Pre-Flight Check</h2>
            <p className="text-white/40 text-xs mt-0.5">Review your deck before presenting</p>
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
              <p className="text-sm">Running checks…</p>
            </div>
          ) : data && overall && (
            <>
              {/* overall verdict */}
              <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${STATUS_META[data.overall === "ready" ? "pass" : data.overall === "warning" ? "warn" : "fail"].bg}`}>
                <span className={`text-2xl ${overall.color}`}>{overall.icon}</span>
                <div>
                  <div className={`font-semibold text-sm ${overall.color}`}>{overall.label}</div>
                  <div className="text-white/40 text-xs mt-0.5">
                    {data.passed} passed · {data.warned} warnings · {data.failed} failed
                  </div>
                </div>
                <button onClick={load} className="ml-auto text-xs text-white/30 hover:text-white/60 transition-colors">Recheck</button>
              </div>

              {/* checks list */}
              <div className="space-y-2">
                {data.checks.map((check) => {
                  const m = STATUS_META[check.status]
                  return (
                    <div key={check.id} className={`flex items-center gap-3 rounded-lg px-4 py-3 border ${m.bg}`}>
                      <span className={`text-lg shrink-0 ${m.color}`}>{m.icon}</span>
                      <div className="flex-1">
                        <div className="text-white/80 text-sm">{check.label}</div>
                        <div className="text-white/40 text-xs mt-0.5">{check.detail}</div>
                      </div>
                      <span className={`text-xs shrink-0 ${m.color}`}>{check.status.toUpperCase()}</span>
                    </div>
                  )
                })}
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
