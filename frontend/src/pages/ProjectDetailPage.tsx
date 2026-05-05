import { useEffect, useState, useCallback } from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { setProjectSchedule, type Project } from "../lib/authApi"
import Logo from "../components/Logo"
import ThemeToggle from "../theme/ThemeToggle"
import BuildTimeline from "../components/BuildTimeline"

const SCHEDULE_OPTIONS: Array<{ value: "on_demand" | "daily" | "weekly" | "monthly" | null; label: string; help: string }> = [
  { value: null,         label: "None",      help: "Manual builds only." },
  { value: "on_demand",  label: "On demand", help: "Built when triggered (manually or by API)." },
  { value: "daily",      label: "Daily",     help: "Auto-refresh every day (cron is phase 2)." },
  { value: "weekly",     label: "Weekly",    help: "Auto-refresh every Monday morning." },
  { value: "monthly",    label: "Monthly",   help: "Auto-refresh on the 1st of each month." },
]

export default function ProjectDetailPage() {
  const { user, loading } = useAuth()
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<Project | null>(null)
  const [error, setError]     = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) return
    try {
      const r = await fetch(`/api/projects/${projectId}`, { credentials: "include" })
      if (r.status === 404) {
        // Fallback: fetch via list (project endpoint may not have a dedicated GET).
        const me = await fetch("/api/orgs", { credentials: "include" }).then((rr) => rr.json())
        for (const o of me.orgs ?? []) {
          const lr = await fetch(`/api/orgs/${o.id}/projects`, { credentials: "include" }).then((rr) => rr.json())
          const p = (lr.projects ?? []).find((x: Project) => x.id === projectId)
          if (p) { setProject(p); return }
        }
        setError("Project not found")
      } else if (r.ok) {
        setProject(await r.json())
      } else {
        const t = await r.text().catch(() => r.statusText)
        setError(`${r.status} ${t}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [projectId])

  useEffect(() => { refresh() }, [refresh])

  const onChangeSchedule = async (v: typeof SCHEDULE_OPTIONS[number]["value"]) => {
    if (!projectId) return
    try {
      const updated = await setProjectSchedule(projectId, v)
      setProject(updated)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-ink text-muted text-sm">Loading…</div>
  if (!user)   return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper">
      {/* top bar */}
      <div className="h-12 shrink-0 border-b border-edge bg-surface flex items-center justify-between px-5 select-none">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/home")}
            className="text-[10px] uppercase tracking-[0.16em] text-muted hover:text-paper flex items-center gap-1.5 transition-colors"
          >
            <span className="text-[12px] leading-none">←</span><span>Home</span>
          </button>
          <span className="text-edge">/</span>
          <Link to="/home" className="flex items-center gap-2.5">
            <Logo size={16} />
            <span className="wordmark text-[12px]">Percy</span>
          </Link>
          <span className="text-edge">/</span>
          <Link to="/projects" className="text-[12px] text-muted hover:text-paper transition-colors">Projects</Link>
          <span className="text-edge">/</span>
          <span className="text-[12px] text-paper truncate max-w-[20rem]">{project?.name ?? "…"}</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle size="xs" />
          {project && (
            <Link
              to={`/studio/${project.id}`}
              className="text-[11px] tracking-[0.16em] uppercase bg-paper text-ink hover:bg-paper/90 px-4 py-1.5 transition-colors font-medium"
            >
              Open in Studio
            </Link>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-12 space-y-12">

          {error && <div className="text-[11px] text-bad bg-bad/10 border border-bad/30 px-3 py-2">{error}</div>}

          {project && (
            <>
              {/* ── Header ───────────────────────────────────────────── */}
              <section>
                <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-2">— Project —</div>
                <h1 className="text-[32px] font-semibold tracking-[-0.01em] text-paper leading-[1.1] mb-3">
                  {project.name}
                </h1>
                <div className="text-[12px] text-muted">
                  {project.doc_source
                    ? <>Source attached. Last updated {new Date(project.updated_at * 1000).toLocaleString()}.</>
                    : <>No source file uploaded yet. <Link to="/projects" className="underline text-paper">Upload via the Projects page.</Link></>
                  }
                </div>
              </section>

              {/* ── Schedule ─────────────────────────────────────────── */}
              <section className="border border-edge p-5">
                <div className="flex items-baseline justify-between mb-3">
                  <div>
                    <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1">— Refresh schedule —</div>
                    <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-paper">When does this rebuild?</h2>
                  </div>
                </div>
                <div className="flex items-center flex-wrap gap-1.5">
                  {SCHEDULE_OPTIONS.map((opt) => {
                    const active = (project.schedule ?? null) === opt.value
                    return (
                      <button
                        key={opt.label}
                        onClick={() => onChangeSchedule(opt.value)}
                        title={opt.help}
                        className={[
                          "text-[11px] tracking-[0.14em] uppercase px-3 py-1.5 border transition-colors",
                          active
                            ? "border-paper bg-paper/10 text-paper"
                            : "border-edge text-muted hover:text-paper hover:bg-paper/5",
                        ].join(" ")}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <div className="text-[10px] text-muted mt-3 italic">
                  Cron-driven auto-refresh ships in phase 2. Until then, this is a label.
                </div>
              </section>

              {/* ── Build timeline ───────────────────────────────────── */}
              <section>
                <BuildTimeline projectId={project.id} />
              </section>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
