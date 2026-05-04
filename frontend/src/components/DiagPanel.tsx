import { useState } from "react"
import type { ReactNode } from "react"
import type { DocInfo, Diagnostic, Grade, DocSummary, HistoryDoc, HistoryEvent } from "../lib/types"
import {
  Activity, AlertTriangle, BarChart3, CheckCircle, Clock, Download, FileWarning,
  Filter, ListChecks,
} from "lucide-react"

interface Props {
  doc: DocInfo | null
  slideN: number
  diagnostics: Diagnostic[]
  grades: Record<number, Grade>
  summary: DocSummary | null
  history: HistoryDoc[]
  onSelectSlide: (slide: number) => void
}

const GRADE_LABEL: Record<Grade, string> = {
  good: "Good",
  partial: "Partial",
  bad: "Bad",
}

export default function DiagPanel({
  doc, slideN, diagnostics, grades, summary, history, onSelectSlide,
}: Props) {
  const [scope, setScope] = useState<"slide" | "deck">("slide")
  const [codeFilter, setCodeFilter] = useState<string | null>(null)

  const total = doc?.slide_count ?? 0
  const gradeSummary = summary?.grade_summary ?? summarizeGrades(grades, total)
  const diagnosticSummary = summary?.diagnostic_summary ?? summarizeDiagnostics(diagnostics)
  const slideDiagnostics = diagnostics.filter(d => d.slide_number === slideN)
  const visibleDiagnostics = (scope === "slide" ? slideDiagnostics : diagnostics)
    .filter(d => !codeFilter || d.code === codeFilter)
  const events = summary?.events ?? []

  function exportCsv() {
    if (!doc) return
    const rows = [["slide", "grade", "diagnostics"]]
    for (let n = 1; n <= total; n++) {
      const diagCount = diagnostics.filter(d => d.slide_number === n).length
      rows.push([String(n), grades[n] ?? "", String(diagCount)])
    }
    const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${doc.name}_evaluation.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col border-l border-edge bg-surface overflow-hidden">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <SummarySection doc={doc} summary={summary} grades={gradeSummary} />

        <section className="px-3 py-3 border-b border-edge">
          <div className="flex items-center justify-between mb-2">
            <PanelTitle icon={<ListChecks size={12} />} label="Grades" />
            {gradeSummary.graded > 0 && (
              <button
                onClick={exportCsv}
                className="p-1 rounded hover:bg-white/10 text-muted"
                title="Export evaluation CSV"
              >
                <Download size={12} />
              </button>
            )}
          </div>
          <div className="text-xs text-muted mb-2">
            {gradeSummary.graded} / {total} reviewed
          </div>
          <GradeBar summary={gradeSummary} total={total} />
          <div className="grid grid-cols-3 gap-1 mt-2 text-xs">
            <Metric label="Good" value={gradeSummary.good} tone="text-good" />
            <Metric label="Partial" value={gradeSummary.partial} tone="text-partial" />
            <Metric label="Bad" value={gradeSummary.bad} tone="text-bad" />
          </div>
        </section>

        <section className="px-3 py-3 border-b border-edge">
          <div className="flex items-center justify-between mb-2">
            <PanelTitle icon={<FileWarning size={12} />} label="Diagnostics" />
            <span className="text-xs text-muted bg-base rounded px-1">{diagnosticSummary.total}</span>
          </div>

          {diagnosticSummary.top_codes.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {diagnosticSummary.top_codes.slice(0, 5).map(item => (
                <button
                  key={item.code}
                  onClick={() => setCodeFilter(codeFilter === item.code ? null : item.code)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border max-w-full truncate ${
                    codeFilter === item.code
                      ? "border-partial bg-partial/10 text-partial"
                      : "border-edge text-muted hover:border-slate-500"
                  }`}
                  title={item.code}
                >
                  {item.code} ({item.count})
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 mb-2">
            <button
              onClick={() => setScope("slide")}
              className={scopeButton(scope === "slide")}
              title="Show selected slide diagnostics"
            >
              <Filter size={10} /> Slide
            </button>
            <button
              onClick={() => setScope("deck")}
              className={scopeButton(scope === "deck")}
              title="Show deck diagnostics"
            >
              <BarChart3 size={10} /> Deck
            </button>
          </div>

          {diagnosticSummary.top_slides.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] uppercase tracking-widest text-muted mb-1">Hot Slides</p>
              <div className="flex flex-wrap gap-1">
                {diagnosticSummary.top_slides.slice(0, 6).map(item => (
                  <button
                    key={item.slide}
                    onClick={() => onSelectSlide(item.slide)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-edge text-slate-400 hover:bg-white/10"
                  >
                    {item.slide} ({item.count})
                  </button>
                ))}
              </div>
            </div>
          )}

          {visibleDiagnostics.length === 0 ? (
            <EmptyDiagnostics doc={doc} scope={scope} />
          ) : (
            <div className="space-y-1">
              {visibleDiagnostics.slice(0, 80).map((d, i) => (
                <DiagRow key={`${d.slide_number ?? "x"}-${d.code}-${i}`} diag={d} onSelectSlide={onSelectSlide} />
              ))}
            </div>
          )}
        </section>

        <TimelineSection events={events} />
        <HistorySection docs={history} currentPath={doc?.source_path} />
      </div>

      {doc && (
        <div className="border-t border-edge px-3 py-2 shrink-0">
          <p className="text-xs text-muted">
            Slide <strong className="text-slate-400">{slideN}</strong> of {total}
            {grades[slideN] && (
              <span className={`ml-2 font-medium ${
                grades[slideN] === "good" ? "text-good" :
                grades[slideN] === "partial" ? "text-partial" : "text-bad"
              }`}>
                {GRADE_LABEL[grades[slideN]]}
              </span>
            )}
            {slideDiagnostics.length > 0 && (
              <span className="ml-2 text-partial">{slideDiagnostics.length} diag</span>
            )}
          </p>
        </div>
      )}
    </aside>
  )
}

function SummarySection({ doc, summary, grades }: {
  doc: DocInfo | null; summary: DocSummary | null; grades: ReturnType<typeof summarizeGrades>
}) {
  if (!doc) {
    return (
      <section className="px-3 py-3 border-b border-edge">
        <PanelTitle icon={<Activity size={12} />} label="Evaluation" />
        <p className="text-xs text-muted mt-2">No document selected</p>
      </section>
    )
  }
  const render = summary?.render_status
  const completion = doc.slide_count > 0 ? Math.round((grades.graded / doc.slide_count) * 100) : 0
  return (
    <section className="px-3 py-3 border-b border-edge">
      <div className="flex items-center justify-between mb-2">
        <PanelTitle icon={<Activity size={12} />} label="Evaluation" />
        <span className="text-[10px] uppercase tracking-widest text-muted">{doc.source_format ?? "pptx"}</span>
      </div>
      <p className="text-xs text-slate-300 font-medium truncate" title={doc.name}>{doc.name}</p>
      <div className="grid grid-cols-3 gap-1 mt-2">
        <Metric label="Reviewed" value={`${completion}%`} tone="text-slate-300" />
        <Metric label="Runs" value={summary?.run_count ?? 0} tone="text-slate-300" />
        <Metric label="Issues" value={summary?.diagnostic_summary.total ?? 0} tone="text-partial" />
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        <StatusChip label="Bridge" ok={render?.has_bridge ?? true} />
        <StatusChip label="Original" ok={doc.has_originals || !!render?.has_originals} />
        <StatusChip label="Rebuilt" ok={doc.has_rebuild || !!render?.has_rebuild} />
      </div>
      {doc.source_format === "pdf" && (
        <p className="text-xs text-muted mt-2 leading-snug">
          PDF is tracked as a visual reconstruction target; PPTX rebuild is disabled.
        </p>
      )}
      {doc.source_format === "tableau" && (
        <p className="text-xs text-muted mt-2 leading-snug">
          Tableau is tracked as extracted workbook artifacts mapped into bridge elements.
        </p>
      )}
    </section>
  )
}

function GradeBar({ summary, total }: { summary: ReturnType<typeof summarizeGrades>; total: number }) {
  return (
    <div className="flex rounded overflow-hidden h-2 gap-px bg-base">
      {summary.good > 0 && <div className="bg-good" style={{ flex: summary.good }} />}
      {summary.partial > 0 && <div className="bg-partial" style={{ flex: summary.partial }} />}
      {summary.bad > 0 && <div className="bg-bad" style={{ flex: summary.bad }} />}
      {(total - summary.graded) > 0 && <div className="bg-edge" style={{ flex: total - summary.graded }} />}
    </div>
  )
}

function TimelineSection({ events }: { events: HistoryEvent[] }) {
  return (
    <section className="px-3 py-3 border-b border-edge">
      <div className="flex items-center justify-between mb-2">
        <PanelTitle icon={<Clock size={12} />} label="Progress" />
        <span className="text-xs text-muted bg-base rounded px-1">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <p className="text-xs text-muted">No persisted events yet</p>
      ) : (
        <div className="space-y-1">
          {events.slice(0, 8).map(event => (
            <div key={event.id} className="border border-edge/70 rounded px-2 py-1 bg-base/30">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  event.status === "ok" ? "bg-good" : event.status === "warn" ? "bg-partial" : "bg-bad"
                }`} />
                <span className="text-xs text-slate-300 truncate">{event.message}</span>
              </div>
              <p className="text-[10px] text-muted mt-0.5">{formatTime(event.ts)} · {event.type}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function HistorySection({ docs, currentPath }: { docs: HistoryDoc[]; currentPath?: string }) {
  const recent = docs.filter(d => d.source_path !== currentPath).slice(0, 5)
  return (
    <section className="px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <PanelTitle icon={<BarChart3 size={12} />} label="Recent Docs" />
        <span className="text-xs text-muted bg-base rounded px-1">{docs.length}</span>
      </div>
      {recent.length === 0 ? (
        <p className="text-xs text-muted">No other deck history</p>
      ) : (
        <div className="space-y-1">
          {recent.map(d => (
            <div key={d.source_path} className="text-xs border-b border-edge/50 pb-1">
              <p className="text-slate-400 truncate" title={d.name}>{d.name}</p>
              <p className="text-muted">
                {d.grade_summary?.graded ?? 0}/{d.slide_count} reviewed · {d.diagnostic_summary?.total ?? 0} diagnostics
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function DiagRow({ diag, onSelectSlide }: { diag: Diagnostic; onSelectSlide: (slide: number) => void }) {
  const codeColor = diag.code.includes("error") || diag.code.includes("fail")
    ? "text-bad"
    : diag.code.includes("warn") || diag.code.includes("unsupported")
    ? "text-partial"
    : "text-muted"

  return (
    <div className="px-2 py-1.5 rounded border border-edge/60 hover:bg-white/5">
      <div className="flex items-start gap-1.5">
        <AlertTriangle size={11} className={`mt-0.5 shrink-0 ${codeColor}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {diag.slide_number && (
              <button
                className="text-[10px] px-1 rounded bg-base text-slate-400 hover:text-accent-light"
                onClick={() => onSelectSlide(diag.slide_number!)}
              >
                {diag.slide_number}
              </button>
            )}
            <p className={`text-xs font-mono truncate ${codeColor}`}>{diag.code}</p>
          </div>
          <p className="text-xs text-muted leading-snug mt-0.5 line-clamp-2">{diag.message}</p>
          {diag.source_shape_name && (
            <p className="text-xs text-slate-500 truncate">{diag.source_shape_name}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyDiagnostics({ doc, scope }: { doc: DocInfo | null; scope: "slide" | "deck" }) {
  return (
    <div className="flex flex-col items-center gap-2 mt-4 text-muted text-xs text-center px-4">
      {doc?.has_rebuild ? (
        <>
          <CheckCircle size={18} className="text-good" />
          <span>No {scope === "slide" ? "slide" : "deck"} diagnostics</span>
        </>
      ) : (
        <>
          <AlertTriangle size={18} />
          <span>{doc?.source_format === "tableau" ? "No Tableau extraction diagnostics yet" : "Run Rebuild to see diagnostics"}</span>
        </>
      )}
    </div>
  )
}

function PanelTitle({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted">
      {icon}
      {label}
    </span>
  )
}

function Metric({ label, value, tone }: { label: string; value: ReactNode; tone: string }) {
  return (
    <div className="rounded border border-edge bg-base/40 px-2 py-1 min-w-0">
      <p className={`text-sm font-semibold ${tone}`}>{value}</p>
      <p className="text-[10px] text-muted truncate">{label}</p>
    </div>
  )
}

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
      ok ? "border-good/40 text-good bg-good/10" : "border-edge text-muted bg-base/40"
    }`}>
      {label}
    </span>
  )
}

function summarizeGrades(grades: Record<number, Grade>, total: number) {
  const result = { good: 0, partial: 0, bad: 0, graded: 0, ungraded: total }
  Object.values(grades).forEach(grade => {
    result[grade] += 1
  })
  result.graded = result.good + result.partial + result.bad
  result.ungraded = Math.max(total - result.graded, 0)
  return result
}

function summarizeDiagnostics(diagnostics: Diagnostic[]) {
  const codes = new Map<string, number>()
  const slides = new Map<number, number>()
  diagnostics.forEach(d => {
    codes.set(d.code, (codes.get(d.code) ?? 0) + 1)
    if (d.slide_number) slides.set(d.slide_number, (slides.get(d.slide_number) ?? 0) + 1)
  })
  return {
    total: diagnostics.length,
    top_codes: [...codes].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, count]) => ({ code, count })),
    top_slides: [...slides].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([slide, count]) => ({ slide, count })),
  }
}

function scopeButton(active: boolean) {
  return `flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${
    active ? "border-accent/40 bg-accent/15 text-accent-light" : "border-edge text-muted hover:bg-white/10"
  }`
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
