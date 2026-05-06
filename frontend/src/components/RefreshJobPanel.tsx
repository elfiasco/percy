import { useEffect, useState } from "react"
import {
  getProjectRefreshJob, createRefreshJob, updateRefreshJob, deleteRefreshJob,
  runRefreshJobNow, listProjectRefreshRuns, listTeamEnvs,
  type RefreshJob, type RefreshRun, type RefreshSchedule, type TeamEnv,
} from "../lib/authApi"
import { useToast, useDialog } from "./Toaster"

const SCHEDULE_OPTIONS: Array<{ value: RefreshSchedule; label: string }> = [
  { value: "on_demand", label: "On demand" },
  { value: "hourly",    label: "Hourly" },
  { value: "daily",     label: "Daily" },
  { value: "weekly",    label: "Weekly" },
  { value: "monthly",   label: "Monthly" },
]

const SAMPLE_SCRIPT = `# Runs in your team-env's Python.
# Available env vars:  PERCY_PROJECT_ID, PERCY_DOC_ID, PERCY_API_BASE,
# plus everything you set in the team env + per-job overrides.
import os
print("project:", os.environ.get("PERCY_PROJECT_ID"))
print("doc:    ", os.environ.get("PERCY_DOC_ID"))
# Example: hit your data warehouse, then patch a slide via Percy's API.
`


export default function RefreshJobPanel({ projectId, orgId }: { projectId: string; orgId: string }) {
  const [job, setJob] = useState<RefreshJob | null>(null)
  const [envs, setEnvs] = useState<TeamEnv[]>([])
  const [runs, setRuns] = useState<RefreshRun[]>([])
  const [busy, setBusy] = useState(false)
  const [scheduleVal, setScheduleVal] = useState<RefreshSchedule>("on_demand")
  const [envId, setEnvId] = useState<string>("")
  const [script, setScript] = useState(SAMPLE_SCRIPT)
  const [extraEnvText, setExtraEnvText] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const toast = useToast()
  const dialog = useDialog()

  const refresh = async () => {
    try {
      const [j, runsR, envsR] = await Promise.all([
        getProjectRefreshJob(projectId),
        listProjectRefreshRuns(projectId),
        listTeamEnvs(orgId),
      ])
      setJob(j.job)
      setRuns(runsR.runs)
      setEnvs(envsR.envs)
      if (j.job) {
        setScheduleVal(j.job.schedule)
        setEnvId(j.job.env_id || "")
        setScript(j.job.script_source || SAMPLE_SCRIPT)
        setExtraEnvText(Object.entries(j.job.extra_env || {}).map(([k, v]) => `${k}=${v}`).join("\n"))
        setEnabled(j.job.enabled)
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => { refresh() }, [projectId])

  const parseEnv = (txt: string): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const line of txt.split("\n")) {
      const t = line.trim()
      if (!t || t.startsWith("#")) continue
      const i = t.indexOf("=")
      if (i <= 0) continue
      out[t.slice(0, i).trim()] = t.slice(i + 1)
    }
    return out
  }

  const onSave = async () => {
    setBusy(true)
    try {
      const extra = parseEnv(extraEnvText)
      if (job) {
        const updated = await updateRefreshJob(job.id, {
          schedule: scheduleVal, env_id: envId || null, script_source: script,
          extra_env: extra, enabled,
        })
        setJob(updated)
        toast.success("Refresh job updated.")
      } else {
        const created = await createRefreshJob({
          project_id: projectId, schedule: scheduleVal,
          env_id: envId || undefined, script_source: script, extra_env: extra,
        })
        setJob(created)
        toast.success("Refresh job created.")
      }
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), "Save failed")
    } finally { setBusy(false) }
  }

  const onRunNow = async () => {
    if (!job) return
    setBusy(true)
    try {
      const r = await runRefreshJobNow(job.id)
      if (r.status === "success") toast.success("Refresh ran successfully.")
      else if (r.status === "started") toast.info("Refresh started — check the runs list.")
      else toast.error(r.error || "Run failed", "Refresh failed")
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), "Run failed")
    } finally { setBusy(false) }
  }

  const onDelete = async () => {
    if (!job) return
    const ok = await dialog.confirm({ title: "Delete refresh job?", body: "Past runs are kept for audit.", confirmLabel: "Delete", danger: true })
    if (!ok) return
    setBusy(true)
    try {
      await deleteRefreshJob(job.id)
      setJob(null); setScript(SAMPLE_SCRIPT); setExtraEnvText(""); setEnvId(""); setScheduleVal("on_demand")
      await refresh()
      toast.success("Job deleted.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <section className="border border-edge p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1">— Refresh job —</div>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-paper">Custom refresh script</h2>
        </div>
        {job && (
          <div className="text-[10px] uppercase tracking-wider text-muted">
            next run: {job.next_run_at ? new Date(job.next_run_at * 1000).toLocaleString() : "—"}
          </div>
        )}
      </div>

      {error && <div className="text-[11px] text-bad bg-bad/10 border border-bad/30 px-3 py-2 mb-3">{error}</div>}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Schedule</label>
          <select value={scheduleVal} onChange={(e) => setScheduleVal(e.target.value as RefreshSchedule)}
            className="w-full text-xs bg-base border border-edge rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-accent">
            {SCHEDULE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Team environment</label>
          <select value={envId} onChange={(e) => setEnvId(e.target.value)}
            className="w-full text-xs bg-base border border-edge rounded px-2 py-1.5 text-slate-200 focus:outline-none focus:border-accent">
            <option value="">(host python — no custom packages)</option>
            {envs.filter((e) => e.status === "ready").map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
            {envs.filter((e) => e.status !== "ready").map((e) => (
              <option key={e.id} value={e.id} disabled>{e.name} ({e.status})</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Refresh script (Python)</label>
        <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={10}
          className="w-full text-xs font-mono bg-base border border-edge rounded px-2 py-2 text-slate-200 focus:outline-none focus:border-accent" />
      </div>

      <div className="mb-4">
        <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Extra env vars (this job only)</label>
        <textarea value={extraEnvText} onChange={(e) => setExtraEnvText(e.target.value)} rows={3}
          placeholder={`SOURCE_TABLE=public.metrics`}
          className="w-full text-xs font-mono bg-base border border-edge rounded px-2 py-2 text-slate-200 focus:outline-none focus:border-accent" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onSave} disabled={busy}
          className="text-[11px] tracking-[0.14em] uppercase px-3 py-1.5 bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-40">
          {job ? "Save changes" : "Create refresh job"}
        </button>
        {job && (
          <>
            <button onClick={onRunNow} disabled={busy}
              className="text-[11px] tracking-[0.14em] uppercase px-3 py-1.5 bg-good/20 text-good border border-good/40 hover:bg-good/30 disabled:opacity-40">
              Run now
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-muted ml-2">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-accent" />
              enabled
            </label>
            <div className="flex-1" />
            <button onClick={onDelete} disabled={busy}
              className="text-[10px] uppercase tracking-wider text-muted hover:text-bad">
              delete job
            </button>
          </>
        )}
      </div>

      {runs.length > 0 && (
        <div className="mt-5 pt-4 border-t border-edge">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2">Recent runs</div>
          <div className="space-y-1">
            {runs.slice(0, 8).map((r) => (
              <details key={r.id} className="border border-edge/60 rounded">
                <summary className="cursor-pointer px-2 py-1.5 flex items-center gap-2 text-[11px]">
                  <span className={
                    r.status === "success" ? "text-good" :
                    r.status === "failed"  ? "text-bad"  : "text-accent"
                  }>● {r.status}</span>
                  <span className="text-muted">{new Date(r.started_at * 1000).toLocaleString()}</span>
                  {r.finished_at && <span className="text-muted/60">· {r.finished_at - r.started_at}s</span>}
                  {r.build_id && <span className="text-muted/60 truncate">· build {r.build_id.slice(0, 12)}</span>}
                </summary>
                {r.log && (
                  <pre className="text-[10px] font-mono px-3 py-2 bg-base/60 max-h-60 overflow-auto whitespace-pre-wrap break-all">{r.log}</pre>
                )}
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
