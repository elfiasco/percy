import { useEffect, useState } from "react"
import {
  type Project,
  type Build,
  type RefreshRun,
  type RefreshJob,
  listBuilds,
  listProjectRefreshRuns,
  getProjectRefreshJob,
} from "../lib/authApi"

/**
 * Timeline24h — a 48-hour window showing pipeline activity.
 *
 * Left half: the last 24 hours (past builds + refresh runs across all
 * projects in the active org). Right half: the next 24 hours of
 * scheduled refreshes, derived from each project's RefreshJob.
 *
 * The horizontal strip gives an at-a-glance picture; the two columns
 * below give readable detail. Empty states render the structure with
 * helpful copy when the workspace is quiet.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000   // 24h on each side of NOW

type EventKind = "success" | "fail" | "running" | "scheduled"

interface TimelineEvent {
  ts:       number          // unix ms
  kind:     EventKind
  project:  string
  detail:   string          // "auto-refresh", "manual build", etc.
  scheduleLabel?: string    // for scheduled events: "hourly", "daily" ...
}

export default function Timeline24h({ projects }: { projects: Project[] }) {
  const [past, setPast]       = useState<TimelineEvent[]>([])
  const [future, setFuture]   = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow]         = useState(() => Date.now())

  // Ticking clock so the NOW marker moves and "in 28m" updates.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const cutoff = Date.now() - WINDOW_MS
        const allPast: TimelineEvent[]   = []
        const allFuture: TimelineEvent[] = []

        // Fan out to every project. With 0–10 projects this is fine.
        await Promise.all(projects.map(async (p) => {
          // Past: builds + refresh runs (in parallel; skip silently on error)
          const builds = await listBuilds(p.id).catch(() => ({ builds: [] as Build[] }))
          for (const b of builds.builds) {
            const ts = b.started_at * 1000
            if (ts >= cutoff) {
              allPast.push({
                ts,
                kind: buildKind(b.status),
                project: p.name,
                detail: b.trigger === "scheduled" ? "auto-build" : "manual build",
              })
            }
          }
          const runs = await listProjectRefreshRuns(p.id).catch(() => ({ runs: [] as RefreshRun[] }))
          for (const r of runs.runs) {
            const ts = r.started_at * 1000
            if (ts >= cutoff) {
              allPast.push({
                ts,
                kind: r.status === "running" ? "running" : r.status === "failed" ? "fail" : "success",
                project: p.name,
                detail: "refresh",
              })
            }
          }
          // Future: derive next firing from refresh job schedule.
          const jobRes = await getProjectRefreshJob(p.id).catch(() => ({ job: null as RefreshJob | null }))
          if (jobRes.job && jobRes.job.schedule !== "on_demand") {
            const upcoming = nextFirings(jobRes.job.schedule, Date.now(), Date.now() + WINDOW_MS)
            for (const ts of upcoming) {
              allFuture.push({
                ts,
                kind: "scheduled",
                project: p.name,
                detail: "refresh",
                scheduleLabel: jobRes.job.schedule,
              })
            }
          }
        }))

        if (cancelled) return
        allPast.sort((a, b) => b.ts - a.ts)
        allFuture.sort((a, b) => a.ts - b.ts)
        setPast(allPast)
        setFuture(allFuture)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projects])

  const allEvents = [...past, ...future]

  return (
    <section className="border border-edge bg-surface rounded-[10px] px-6 py-5 shadow-sm">
      <div className="flex justify-between items-baseline mb-7">
        <h2 className="text-[14px] font-semibold tracking-[-0.005em] text-muted">
          Pipelines · 24 hour window
        </h2>
        <div className="flex gap-4 text-[11px] text-muted">
          <Swatch kind="success">success</Swatch>
          <Swatch kind="fail">flagged</Swatch>
          <Swatch kind="scheduled">scheduled</Swatch>
        </div>
      </div>

      <Strip events={allEvents} now={now} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-edge pt-4">
        <Column
          title={`Last 24 hours · ${past.length} run${past.length === 1 ? "" : "s"}`}
          events={past.slice(0, 6)}
          emptyText={loading ? "Loading…" : "No runs in the last 24 hours."}
          now={now}
          past
        />
        <Column
          title={`Next 24 hours · ${future.length} scheduled`}
          events={future.slice(0, 6)}
          emptyText={loading ? "Loading…" : "No refresh jobs scheduled in the next 24 hours."}
          now={now}
        />
      </div>
    </section>
  )
}

// ── Strip ────────────────────────────────────────────────────────────────────

function Strip({ events, now }: { events: TimelineEvent[]; now: number }) {
  return (
    <div className="relative h-9 mb-8">
      {/* axis line */}
      <div className="absolute bottom-[18px] left-0 right-0 h-px bg-edge" />

      {/* axis ticks */}
      {[0, 25, 75, 100].map((pct) => (
        <span key={pct}
          className="absolute top-[26px] -translate-x-1/2 font-mono text-[10px] text-muted tracking-wide"
          style={{ left: `${pct}%` }}
        >
          {pct === 0 ? "−24h" : pct === 25 ? "−12h" : pct === 75 ? "+12h" : "+24h"}
        </span>
      ))}

      {/* NOW vertical line + label */}
      <div className="absolute top-0 bottom-3 left-1/2 w-0.5 bg-champagne rounded-sm">
        <span className="absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[10px] font-bold text-champagne tracking-[0.08em] bg-surface px-1.5 whitespace-nowrap">
          NOW · {fmtTime(now)}
        </span>
      </div>

      {/* events */}
      {events.map((e, i) => {
        const pct = positionPct(e.ts, now)
        if (pct < 0 || pct > 100) return null
        return (
          <span
            key={i}
            className={dotClass(e.kind)}
            style={{ left: `${pct}%`, bottom: 14 }}
            title={`${fmtTime(e.ts)} — ${e.project} · ${e.detail}`}
          />
        )
      })}
    </div>
  )
}

function dotClass(kind: EventKind): string {
  const base = "absolute -translate-x-1/2 rounded-full cursor-pointer transition-transform hover:scale-150"
  if (kind === "scheduled") return `${base} w-2 h-2 bg-transparent border-[1.5px] border-champagne`
  if (kind === "fail")      return `${base} w-2.5 h-2.5 bg-bad`
  if (kind === "running")   return `${base} w-2.5 h-2.5 bg-champagne shadow-[0_0_0_4px_rgb(var(--champagne)/0.25)]`
  return                      `${base} w-2.5 h-2.5 bg-good`
}

// ── Column ───────────────────────────────────────────────────────────────────

function Column({
  title, events, emptyText, now, past,
}: {
  title: string
  events: TimelineEvent[]
  emptyText: string
  now: number
  past?: boolean
}) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted mb-3">
        {title}
      </h3>
      {events.length === 0 ? (
        <div className="text-[12px] text-muted/70 italic py-2">{emptyText}</div>
      ) : (
        <div className="flex flex-col">
          {events.map((e, i) => (
            <Row key={i} ev={e} now={now} past={past} last={i === events.length - 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function Row({
  ev, now, past, last,
}: { ev: TimelineEvent; now: number; past?: boolean; last: boolean }) {
  return (
    <div className={`grid grid-cols-[68px_14px_1fr_auto] gap-2.5 py-1.5 items-baseline text-[13px] ${last ? "" : "border-b border-edge/40 border-dotted"}`}>
      <span className="font-mono text-[11px] text-muted tabular-nums uppercase tracking-wide">
        {fmtRel(ev.ts, now)}
      </span>
      <span className={`self-center rounded-full ${pipClass(ev.kind)}`} />
      <span className="text-paper">
        <strong className="font-semibold">{ev.project}</strong>
        <span className="text-muted text-[11px] ml-1">· {ev.detail}{ev.scheduleLabel && ev.scheduleLabel !== "on_demand" ? ` (${ev.scheduleLabel})` : ""}</span>
      </span>
      <span className={statusClass(ev.kind)}>
        {past ? statusLabel(ev.kind) : `in ${fmtUntil(ev.ts, now)}`}
      </span>
    </div>
  )
}

function pipClass(kind: EventKind): string {
  if (kind === "scheduled") return "w-1.5 h-1.5 bg-transparent border-[1.5px] border-champagne"
  if (kind === "fail")      return "w-2 h-2 bg-bad"
  if (kind === "running")   return "w-2 h-2 bg-champagne"
  return                      "w-2 h-2 bg-good"
}

function statusClass(kind: EventKind): string {
  const base = "text-[10px] font-medium uppercase tracking-wide"
  if (kind === "scheduled") return `${base} text-champagne font-semibold`
  if (kind === "fail")      return `${base} text-bad`
  if (kind === "running")   return `${base} text-champagne`
  return                      `${base} text-good`
}

function statusLabel(kind: EventKind): string {
  if (kind === "fail")    return "flagged"
  if (kind === "running") return "running"
  return "clean"
}

function Swatch({ kind, children }: { kind: EventKind; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={pipClass(kind) + " rounded-full"} />
      {children}
    </span>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildKind(status: string): EventKind {
  if (status === "running" || status === "queued" || status === "pending") return "running"
  if (status === "success" || status === "succeeded" || status === "ok")   return "success"
  return "fail"
}

function positionPct(ts: number, now: number): number {
  // 0% = now - 24h, 50% = now, 100% = now + 24h
  return ((ts - (now - WINDOW_MS)) / (2 * WINDOW_MS)) * 100
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
}

function fmtRel(ts: number, now: number): string {
  const sameDay = new Date(ts).toDateString() === new Date(now).toDateString()
  if (sameDay) return fmtTime(ts)
  const diff = ts - now
  if (diff > 0) return `TOM ${fmtTime(ts)}`
  return `YEST ${fmtTime(ts)}`
}

function fmtUntil(ts: number, now: number): string {
  const ms = ts - now
  if (ms < 0) return "now"
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h < 24) return r ? `${h}h ${r}m` : `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

/**
 * Project the next firings of a refresh schedule into the (now, end] window.
 * Best-effort only — server-side cron is the source of truth; this is just
 * for the dashboard preview.
 */
function nextFirings(schedule: string, now: number, end: number): number[] {
  const out: number[] = []
  const d = new Date(now)
  if (schedule === "hourly") {
    const next = new Date(d); next.setMinutes(0, 0, 0); next.setHours(d.getHours() + 1)
    for (let t = next.getTime(); t <= end; t += 3600_000) out.push(t)
  } else if (schedule === "daily") {
    const next = new Date(d); next.setHours(9, 0, 0, 0)
    if (next.getTime() <= now) next.setDate(next.getDate() + 1)
    if (next.getTime() <= end) out.push(next.getTime())
  } else if (schedule === "weekly") {
    const next = new Date(d); next.setHours(9, 0, 0, 0)
    const daysUntilMon = (8 - next.getDay()) % 7 || 7
    next.setDate(next.getDate() + daysUntilMon)
    if (next.getTime() <= end) out.push(next.getTime())
  } else if (schedule === "monthly") {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1, 9, 0, 0)
    if (next.getTime() <= end) out.push(next.getTime())
  }
  return out
}
