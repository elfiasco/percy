/**
 * TemplateVariablesPanel — detects {variable_name} placeholders in the deck
 * and lets users fill them in and apply all replacements at once.
 */

import { useState, useEffect, useCallback } from "react"
import { fetchTemplateVariables, replaceText, type TemplateVariable } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onApplied?: () => void
}

export default function TemplateVariablesPanel({ docId, onClose, onApplied }: Props) {
  const [variables, setVariables]   = useState<TemplateVariable[]>([])
  const [values, setValues]         = useState<Record<string, string>>({})
  const [loading, setLoading]       = useState(true)
  const [applying, setApplying]     = useState(false)
  const [result, setResult]         = useState<{ replaced: number; vars: number } | null>(null)
  const [includeNotes, setIncludeNotes] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setResult(null)
    fetchTemplateVariables(docId, includeNotes)
      .then((r) => {
        setVariables(r.variables)
        setValues((prev) => {
          const next: Record<string, string> = {}
          for (const v of r.variables) {
            next[v.name] = prev[v.name] ?? ""
          }
          return next
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [docId, includeNotes])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const handleApply = useCallback(async () => {
    const toReplace = variables.filter((v) => values[v.name]?.trim())
    if (!toReplace.length) return
    setApplying(true)
    let totalReplaced = 0
    let varsReplaced = 0
    try {
      for (const v of toReplace) {
        const r = await replaceText(docId, `{${v.name}}`, values[v.name].trim(), false, false, includeNotes)
        if (r.replaced > 0) {
          totalReplaced += r.replaced
          varsReplaced++
        }
      }
      setResult({ replaced: totalReplaced, vars: varsReplaced })
      if (totalReplaced > 0) onApplied?.()
      // Reload to find remaining variables
      load()
    } catch (e) { console.error("template apply failed:", e) }
    finally { setApplying(false) }
  }, [variables, values, docId, includeNotes, onApplied, load])

  const filledCount = variables.filter((v) => values[v.name]?.trim()).length

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[520px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-200">⚙ Template Variables</span>
            {variables.length > 0 && (
              <span className="text-[11px] text-muted/70">{variables.length} variable{variables.length !== 1 ? "s" : ""} found</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
                className="accent-accent w-3 h-3"
              />
              <span className="text-[10px] text-muted">Include notes</span>
            </label>
            <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg leading-none ml-1">✕</button>
          </div>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted text-sm animate-pulse">
              Scanning for variables…
            </div>
          ) : variables.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <span className="text-3xl opacity-40">⚙</span>
              <p className="text-sm text-muted text-center">
                No template variables found.
              </p>
              <p className="text-[11px] text-muted/60 text-center max-w-xs">
                Add placeholders like <code className="bg-white/10 px-1 rounded">{"{company_name}"}</code>,{" "}
                <code className="bg-white/10 px-1 rounded">{"{date}"}</code> to your slides,
                then open this panel to fill them in.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-muted/70 mb-4">
                Fill in values to replace all placeholders at once.
                Leave a field empty to skip that variable.
              </p>
              {variables.map((v) => (
                <div key={v.name} className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                        {"{"}
                        {v.name}
                        {"}"}
                      </code>
                      <span className="text-[10px] text-muted/50">
                        {v.count} occurrence{v.count !== 1 ? "s" : ""}
                        {" · "}
                        {[...new Set(v.occurrences.map((o) => o.slide_n))].length} slide{[...new Set(v.occurrences.map((o) => o.slide_n))].length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={values[v.name] ?? ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                      placeholder={`Enter value for {${v.name}}…`}
                      className="w-full text-sm bg-base border border-edge rounded px-3 py-1.5
                                 text-slate-200 focus:outline-none focus:border-accent placeholder:text-muted/40"
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === "Enter" && filledCount > 0 && !applying) handleApply()
                      }}
                    />
                    {v.occurrences[0]?.context && (
                      <p className="text-[10px] text-muted/50 mt-0.5 truncate">
                        e.g.: …{v.occurrences[0].context.slice(0, 60)}…
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* footer */}
        {variables.length > 0 && (
          <div className="shrink-0 px-5 py-3 border-t border-edge space-y-2">
            {result && (
              <div className={`text-xs rounded px-3 py-2 border ${
                result.replaced > 0
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-white/5 border-edge text-muted"
              }`}>
                {result.replaced > 0
                  ? `Applied ${result.vars} variable${result.vars !== 1 ? "s" : ""} — ${result.replaced} replacement${result.replaced !== 1 ? "s" : ""} made`
                  : "No matching occurrences found"}
              </div>
            )}
            <button
              onClick={handleApply}
              disabled={applying || filledCount === 0}
              className="w-full text-sm py-2 rounded bg-accent/20 text-accent border border-accent/30
                         hover:bg-accent/30 transition-colors disabled:opacity-40"
            >
              {applying
                ? "Applying…"
                : filledCount === 0
                ? "Fill in at least one variable to apply"
                : `Apply ${filledCount} variable${filledCount !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
