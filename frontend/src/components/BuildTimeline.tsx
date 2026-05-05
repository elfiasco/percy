import { useEffect, useState, useCallback } from "react"
import {
  listBuilds, triggerBuild, buildFileUrl,
  type Build, type BuildFormat, type BuildStatus,
} from "../lib/authApi"

const FORMAT_LABEL: Record<BuildFormat, string> = {
  pptx:     "PPTX",
  pdf:      "PDF",
  png_zip:  "PNG.ZIP",
  html:     "HTML",
  markdown: "MD",
  percy:    ".PERCY",
}

const FORMAT_ORDER: BuildFormat[] = ["pptx", "pdf", "percy", "html", "markdown", "png_zip"]

interface Props {
  projectId: string
  /** Compact mode for dashboard tile (3-4 most recent, no header). */
  compact?: boolean
  /** Hide the "Build now" button (for read-only contexts). */
  readOnly?: boolean
}

export default function BuildTimeline({ projectId, compact = false, readOnly = false }: Props) {
  const [builds, setBuilds]   = useState<Build[] | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [selectedFormats, setSelectedFormats] = useState<BuildFormat[]>(["pptx", "pdf"])

  const refresh = useCallback(async () => {
    try {
      const r = await listBuilds(projectId)
      setBuilds(r.builds)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [projectId])

  useEffect(() => { refresh() }, [refresh])

  const onBuild = useCallback(async () => {
    if (running) return
    setRunning(true)
    try {
      await triggerBuild(projectId, selectedFormats, "manual")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }, [projectId, selectedFormats, running, refresh])

  const items = compact ? (builds ?? []).slice(0, 4) : (builds ?? [])

  return (
    <div className="flex flex-col">
      {!compact && (
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1">— Builds —</div>
            <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-paper">Refresh history</h3>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              <FormatPicker selected={selectedFormats} onChange={setSelectedFormats} />
              <button
                onClick={onBuild}
                disabled={running || selectedFormats.length === 0}
                className="text-[11px] tracking-[0.16em] uppercase bg-paper text-ink hover:bg-paper/90 px-4 py-2 transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {running && <span className="inline-block w-2 h-2 border border-ink border-t-transparent rounded-full animate-spin" />}
                {running ? "Building" : "Build now"}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <div className="text-[11px] text-bad bg-bad/10 border border-bad/30 px-3 py-2 mb-3">{error}</div>}

      {builds == null ? (
        <div className="text-[12px] text-muted italic">Loading…</div>
      ) : items.length === 0 ? (
        <div className="border border-edge p-8 text-center">
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-2">— No builds yet —</div>
          <div className="text-[13px] text-muted leading-[1.7] max-w-md mx-auto">
            Trigger your first build to render this project to one or more output formats.
            Each build appears here with its timestamp, status, and the files produced.
          </div>
        </div>
      ) : (
        <ol className="relative">
          {/* spine — the hairline that runs the length of the timeline */}
          <div className="absolute left-3 top-2 bottom-2 w-px bg-edge" aria-hidden />
          {items.map((b, i) => (
            <BuildRow key={b.id} build={b} isLast={i === items.length - 1} />
          ))}
        </ol>
      )}
    </div>
  )
}

function BuildRow({ build }: { build: Build; isLast: boolean }) {
  const started  = new Date(build.started_at * 1000)
  const finished = build.finished_at ? new Date(build.finished_at * 1000) : null
  const dotTone =
    build.status === "success" ? "bg-champagne" :
    build.status === "failed"  ? "bg-bad" :
    build.status === "running" ? "bg-paper animate-pulse" :
    "bg-muted/60"

  const elapsed = build.elapsed_ms != null ? formatElapsed(build.elapsed_ms) : null
  const formats = (Object.keys(build.outputs ?? {}) as BuildFormat[])
    .sort((a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b))

  return (
    <li className="relative pl-9 pb-6">
      {/* dot on the spine */}
      <span
        className={`absolute left-[7px] top-2 w-3 h-3 rounded-full ${dotTone} ring-2 ring-ink`}
        aria-hidden
      />

      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-[10px] tracking-[0.18em] uppercase text-muted">
          {started.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
        <StatusBadge status={build.status} />
        {build.trigger && build.trigger !== "manual" && (
          <span className="text-[10px] tracking-[0.14em] uppercase text-muted">· {build.trigger}</span>
        )}
        <div className="flex-1" />
        {elapsed && <span className="text-[10px] text-muted/70 font-mono">{elapsed}</span>}
      </div>

      {build.summary && (
        <div className="text-[12px] text-paper mb-2">{build.summary}</div>
      )}

      {build.error && (
        <div className="text-[11px] text-bad bg-bad/10 border-l-2 border-bad px-2 py-1.5 mb-2 font-mono whitespace-pre-wrap break-words">
          {build.error}
        </div>
      )}

      {formats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {formats.map((f) => (
            <a key={f}
               href={buildFileUrl(build.id, f)}
               download
               className="inline-flex items-center gap-1 text-[10px] tracking-[0.12em] uppercase border border-edge px-2 py-1 text-paper hover:bg-paper/5 transition-colors"
            >
              <span className="text-muted">↓</span>
              <span>{FORMAT_LABEL[f]}</span>
            </a>
          ))}
        </div>
      )}

      {!build.summary && !build.error && build.status === "running" && (
        <div className="text-[11px] text-muted italic">Building…{finished ? "" : " (this can take a moment)"}</div>
      )}
    </li>
  )
}

function StatusBadge({ status }: { status: BuildStatus }) {
  const cfg = {
    success: { label: "Built",   bg: "bg-champagne/15 text-champagne border-champagne/40" },
    failed:  { label: "Failed",  bg: "bg-bad/15      text-bad      border-bad/40" },
    running: { label: "Running", bg: "bg-paper/10    text-paper    border-paper/30" },
    queued:  { label: "Queued",  bg: "bg-muted/15    text-muted    border-edge" },
  }[status]
  return (
    <span className={`text-[9px] tracking-[0.18em] uppercase border px-1.5 py-0.5 ${cfg.bg}`}>
      {cfg.label}
    </span>
  )
}

function FormatPicker({
  selected, onChange,
}: { selected: BuildFormat[]; onChange: (v: BuildFormat[]) => void }) {
  const all: BuildFormat[] = ["pptx", "pdf", "html", "markdown", "png_zip", "percy"]
  return (
    <div className="flex items-center gap-1">
      {all.map((f) => {
        const active = selected.includes(f)
        return (
          <button
            key={f}
            onClick={() =>
              onChange(active ? selected.filter((x) => x !== f) : [...selected, f])
            }
            title={`Toggle ${FORMAT_LABEL[f]}`}
            className={[
              "text-[9px] tracking-[0.14em] uppercase border px-2 py-1 transition-colors",
              active
                ? "border-paper bg-paper/10 text-paper"
                : "border-edge text-muted hover:text-paper hover:bg-paper/5",
            ].join(" ")}
          >
            {FORMAT_LABEL[f]}
          </button>
        )
      })}
    </div>
  )
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}
