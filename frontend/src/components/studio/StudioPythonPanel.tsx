import { useEffect, useState } from "react"
import { listTeamEnvs, evalInEnv, pollEvalResult, type TeamEnv, type EvalResult } from "../../lib/authApi"

interface Props {
  open: boolean
  onClose: () => void
  orgId: string
  /** Optional context — passed to the script as PERCY_* env vars. */
  docId?: string
  slideIndex?: number | null
  selectedElementId?: string | null
}

const DEFAULT_SCRIPT = `# Test scratch — runs inside your selected team env's venv.
# Available env vars (when present):
#   PERCY_DOC_ID, PERCY_SLIDE_INDEX, PERCY_ELEMENT_ID, PERCY_API_BASE
# plus everything from the team env's env_vars block.
import os
print("doc:    ", os.environ.get("PERCY_DOC_ID"))
print("slide:  ", os.environ.get("PERCY_SLIDE_INDEX"))
print("element:", os.environ.get("PERCY_ELEMENT_ID"))
`


export default function StudioPythonPanel({
  open, onClose, orgId, docId, slideIndex, selectedElementId,
}: Props) {
  const [envs, setEnvs] = useState<TeamEnv[]>([])
  const [envId, setEnvId] = useState("")
  const [script, setScript] = useState(DEFAULT_SCRIPT)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<EvalResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<"doc" | "slide" | "element">("doc")

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await listTeamEnvs(orgId)
        if (cancelled) return
        setEnvs(r.envs)
        if (r.envs.length && !envId) {
          const ready = r.envs.find((e) => e.status === "ready") || r.envs[0]
          setEnvId(ready.id)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [open, orgId])

  const onRun = async () => {
    if (!envId) { setError("Pick a team environment first."); return }
    setRunning(true); setError(null); setResult(null)
    try {
      const ctx: Record<string, string> = {}
      if (docId) ctx.PERCY_DOC_ID = docId
      if (scope !== "doc" && slideIndex != null) ctx.PERCY_SLIDE_INDEX = String(slideIndex)
      if (scope === "element" && selectedElementId) ctx.PERCY_ELEMENT_ID = selectedElementId
      const dispatch = await evalInEnv(envId, { script, context: ctx, timeout_s: 60 })
      const final = await pollEvalResult(dispatch.eval_id, { maxWaitMs: 120_000 })
      setResult(final)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setRunning(false) }
  }

  if (!open) return null

  return (
    <div className="fixed bottom-0 right-0 w-[640px] max-w-[95vw] h-[55vh] bg-surface border-l border-t border-edge shadow-2xl flex flex-col z-30">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted">— Python scratch —</span>
          <select value={envId} onChange={(e) => setEnvId(e.target.value)}
            className="text-xs bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent">
            <option value="">(pick env)</option>
            {envs.filter((e) => e.status === "ready").map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
            {envs.filter((e) => e.status !== "ready").map((e) => (
              <option key={e.id} value={e.id} disabled>{e.name} ({e.status})</option>
            ))}
          </select>
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}
            className="text-xs bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent">
            <option value="doc">scope: whole deck</option>
            <option value="slide" disabled={slideIndex == null}>scope: this slide</option>
            <option value="element" disabled={!selectedElementId}>scope: selected element</option>
          </select>
          <button onClick={onRun} disabled={running || !envId}
            className="text-[11px] uppercase tracking-wider px-3 py-1 bg-good/20 text-good border border-good/40 hover:bg-good/30 disabled:opacity-40">
            {running ? "Running…" : "Test now"}
          </button>
        </div>
        <button onClick={onClose} className="text-muted hover:text-paper text-lg w-7 h-7 rounded hover:bg-white/10">×</button>
      </div>

      <div className="grid grid-rows-[1fr_auto_1fr] flex-1 min-h-0 divide-y divide-edge">
        <textarea
          value={script} onChange={(e) => setScript(e.target.value)}
          spellCheck={false}
          placeholder="# Python script…"
          className="w-full h-full text-xs font-mono bg-base text-slate-200 px-3 py-2 focus:outline-none resize-none"
        />
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted flex items-center gap-3">
          <span>Output</span>
          {result && (
            <span className={result.exit_code === 0 ? "text-good" : "text-bad"}>
              exit {result.exit_code} · {result.elapsed_ms}ms
            </span>
          )}
          {result?.note && <span className="text-amber italic">{result.note}</span>}
          {error && <span className="text-bad">error: {error}</span>}
        </div>
        <div className="overflow-auto bg-ink">
          {result?.stdout && (
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all px-3 py-2 text-slate-200">{result.stdout}</pre>
          )}
          {result?.stderr && (
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all px-3 py-2 text-bad">{result.stderr}</pre>
          )}
          {!result && !error && (
            <div className="text-[11px] text-muted/70 italic px-3 py-2">No output yet — hit Test now.</div>
          )}
        </div>
      </div>
    </div>
  )
}
