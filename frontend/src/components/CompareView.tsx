import { useState, useEffect } from "react"
import type { DocInfo, Grade, VisionGradeResult } from "../lib/types"
import { slideUrl } from "../lib/api"
import { BrainCircuit, Loader2, ZoomIn, ZoomOut } from "lucide-react"

interface Props {
  doc: DocInfo
  slideN: number
  grades: Record<number, Grade>
  pixelScores: Record<number, number>
  cacheBust: number
  onGrade: (slideN: number, grade: Grade) => void
  onVisionGrade: (slideN: number, target: "bridge" | "rebuilt") => void
  visionResult: VisionGradeResult | null
  visionLoading: "bridge" | "rebuilt" | null
  rebuildPhase: "building" | "rendering" | null
}

type Panel = "original" | "bridge" | "rebuilt"

const PANELS: { key: Panel; label: string; color: string }[] = [
  { key: "original", label: "Original PPTX",  color: "text-slate-400" },
  { key: "bridge",   label: "Bridge Render",   color: "text-accent-light" },
  { key: "rebuilt",  label: "Rebuilt PPTX",    color: "text-good" },
]

const GRADE_CONFIG: { grade: Grade; label: string; cls: string }[] = [
  { grade: "good",    label: "✓ Good",    cls: "border-good   text-good   hover:bg-good/20"    },
  { grade: "partial", label: "~ Partial", cls: "border-partial text-partial hover:bg-partial/20" },
  { grade: "bad",     label: "✗ Bad",     cls: "border-bad    text-bad    hover:bg-bad/20"     },
]

function pixelScoreColor(rms: number): string {
  if (rms < 5)  return "text-good"
  if (rms < 15) return "text-partial"
  return "text-bad"
}

export default function CompareView({
  doc, slideN, grades, pixelScores, cacheBust, onGrade, onVisionGrade, visionResult, visionLoading, rebuildPhase,
}: Props) {
  const [zoom, setZoom]               = useState(1.0)
  const [visiblePanels, setVisible]   = useState<Set<Panel>>(
    new Set(["original", "bridge", "rebuilt"])
  )

  const totalSlides = doc.slide_count
  const grade = grades[slideN]

  function togglePanel(p: Panel) {
    setVisible(prev => {
      const next = new Set(prev)
      if (next.has(p) && next.size > 1) next.delete(p)
      else next.add(p)
      return next
    })
  }

  function getUrl(panel: Panel): string {
    const bust = cacheBust ? `?v=${cacheBust}` : ""
    switch (panel) {
      case "original": return slideUrl.original(doc.doc_id, slideN)
      case "bridge":   return slideUrl.bridge(doc.doc_id, slideN) + bust
      case "rebuilt":  return slideUrl.rebuilt(doc.doc_id, slideN)
    }
  }

  function isAvailable(panel: Panel): boolean {
    if (panel === "original") return doc.has_originals
    if (panel === "rebuilt")  return doc.has_rebuild || !!rebuildPhase
    return true
  }

  const activePanels = PANELS.filter(p => visiblePanels.has(p.key) && isAvailable(p.key))
  const panelLabel = (panel: Panel, fallback: string) =>
    panel === "original" && doc.source_format === "pdf" ? "Original PDF" : fallback

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-base">
      {/* toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-edge bg-surface shrink-0 flex-wrap">
        {/* panel toggles */}
        <div className="flex gap-1">
          {PANELS.map(p => (
            <button
              key={p.key}
              onClick={() => togglePanel(p.key)}
              disabled={!isAvailable(p.key)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors
                ${visiblePanels.has(p.key) && isAvailable(p.key)
                  ? "border-edge bg-white/10 " + p.color
                  : "border-transparent text-muted opacity-50"}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* zoom */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            className="p-1 rounded hover:bg-white/10 text-muted"
            onClick={() => setZoom(z => Math.max(0.4, z - 0.15))}
          >
            <ZoomOut size={13} />
          </button>
          <span className="text-xs text-muted w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button
            className="p-1 rounded hover:bg-white/10 text-muted"
            onClick={() => setZoom(z => Math.min(2.5, z + 0.15))}
          >
            <ZoomIn size={13} />
          </button>
          <button
            className="text-xs px-2 py-0.5 rounded border border-edge text-muted ml-1 hover:bg-white/10"
            onClick={() => setZoom(1.0)}
          >
            Reset
          </button>
        </div>

        {/* slide position */}
        <span className="text-xs text-muted">
          {slideN} / {totalSlides}
        </span>
      </div>

      {/* slide panels */}
      <div className="flex flex-1 min-h-0 overflow-auto scrollbar-thin gap-px bg-edge">
        {activePanels.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-muted text-sm">
            No panels visible
          </div>
        ) : (
          activePanels.map(p => (
            p.key === "rebuilt" && rebuildPhase ? (
              <RebuildProgressPanel key="rebuilt" phase={rebuildPhase} label={p.label} labelClass={p.color} />
            ) : (
              <SlidePanel
                key={p.key}
                label={panelLabel(p.key, p.label)}
                labelClass={p.color}
                src={getUrl(p.key)}
                zoom={zoom}
              />
            )
          ))
        )}
      </div>

      {/* grade bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-t border-edge bg-surface shrink-0">
        <span className="text-xs text-muted">Grade slide {slideN}:</span>
        <div className="flex gap-2">
          {GRADE_CONFIG.map(({ grade: g, label, cls }) => (
            <button
              key={g}
              onClick={() => onGrade(slideN, g)}
              className={`text-xs px-3 py-1 rounded border transition-colors font-medium
                ${grade === g ? cls + " bg-opacity-30" : "border-edge text-muted hover:border-slate-500"}
                ${cls}`}
            >
              {label}
            </button>
          ))}
        </div>
        {pixelScores[slideN] !== undefined && (
          <>
            <div className="h-5 w-px bg-edge" />
            <span className="text-xs text-muted">Pixel RMS:</span>
            <span className={`text-xs font-semibold tabular-nums ${pixelScoreColor(pixelScores[slideN])}`}
              title="Per-pixel RMS difference vs original COM render (lower = more accurate)">
              {pixelScores[slideN].toFixed(1)}
            </span>
          </>
        )}
        <div className="h-5 w-px bg-edge" />
        <span className="text-xs text-muted">LM Studio:</span>
        <button
          className="btn-xs"
          disabled={!!visionLoading || !doc.has_originals}
          onClick={() => onVisionGrade(slideN, "bridge")}
          title="Compare original render to bridge render with the local LM Studio vision model"
        >
          {visionLoading === "bridge" ? <Loader2 size={11} className="animate-spin" /> : <BrainCircuit size={11} />}
          Bridge
        </button>
        <button
          className="btn-xs"
          disabled={!!visionLoading || !doc.has_originals || !doc.has_rebuild || rebuildPhase === "rendering"}
          onClick={() => onVisionGrade(slideN, "rebuilt")}
          title="Compare original render to rebuilt PPTX render with the local LM Studio vision model"
        >
          {visionLoading === "rebuilt" ? <Loader2 size={11} className="animate-spin" /> : <BrainCircuit size={11} />}
          Rebuilt
        </button>
        {grade && (
          <span className="ml-auto text-xs text-muted">
            Graded: <strong className={
              grade === "good" ? "text-good" : grade === "partial" ? "text-partial" : "text-bad"
            }>{grade}</strong>
          </span>
        )}
      </div>
      {visionResult && visionResult.slide_n === slideN && (
        <VisionResultBar result={visionResult} />
      )}
    </div>
  )
}

function VisionResultBar({ result }: { result: VisionGradeResult }) {
  const parsed = result.vision.parsed
  const parsedObj = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
  const grade = typeof parsedObj?.grade === "string" ? parsedObj.grade : result.vision.status
  const summary = typeof parsedObj?.summary === "string"
    ? parsedObj.summary
    : result.vision.raw ?? result.vision.error ?? "No model response"
  const comparisons = Array.isArray(parsedObj?.element_comparisons)
    ? parsedObj.element_comparisons.slice(0, 4) as Record<string, unknown>[]
    : []

  return (
    <div className="px-4 py-2 border-t border-edge bg-base/80 shrink-0">
      <div className="flex items-start gap-3 min-w-0">
        <span className={`text-xs font-semibold uppercase tracking-widest ${
          grade === "good" ? "text-good" : grade === "bad" || result.vision.status === "error" ? "text-bad" : "text-partial"
        }`}>
          {result.target} · {grade}
        </span>
        <span className="text-xs text-muted shrink-0">RMS {result.rms}</span>
        <p className="text-xs text-slate-300 truncate" title={summary}>{summary}</p>
      </div>
      {comparisons.length > 0 && (
        <div className="grid grid-cols-2 gap-1 mt-2">
          {comparisons.map((item, i) => {
            const element = String(item.element ?? "Element")
            const status = String(item.status ?? "")
            const difference = String(item.difference ?? item.candidate ?? "")
            return (
              <div key={`${element}-${i}`} className="rounded border border-edge/70 bg-surface px-2 py-1 min-w-0">
                <div className="flex items-center gap-1 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    status.includes("major") || status === "missing" ? "bg-bad" :
                    status.includes("minor") ? "bg-partial" : "bg-good"
                  }`} />
                  <span className="text-[10px] text-slate-300 font-medium truncate" title={element}>{element}</span>
                </div>
                <p className="text-[10px] text-muted truncate" title={difference}>{difference}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RebuildProgressPanel({ phase, label, labelClass }: {
  phase: "building" | "rendering"; label: string; labelClass: string
}) {
  const isBuilding = phase === "building"
  return (
    <div className="flex flex-col flex-1 min-w-0 bg-base overflow-auto scrollbar-thin">
      <div className="text-xs px-3 py-1 border-b border-edge bg-surface shrink-0">
        <span className={labelClass + " font-medium"}>{label}</span>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className={`flex flex-col items-center gap-4 p-8 rounded-xl border ${
          isBuilding ? "border-amber-700/40 bg-amber-950/20" : "border-sky-700/40 bg-sky-950/20"
        }`}>
          <span className={`inline-block w-8 h-8 border-4 rounded-full animate-spin ${
            isBuilding ? "border-amber-400 border-t-transparent" : "border-sky-400 border-t-transparent"
          }`} />
          <div className="flex flex-col items-center gap-1 text-center">
            <span className={`text-sm font-semibold ${isBuilding ? "text-amber-300" : "text-sky-300"}`}>
              {isBuilding ? "Building PPTX…" : "Rendering Slides…"}
            </span>
            <span className="text-xs text-muted max-w-48 leading-relaxed">
              {isBuilding
                ? "Reconstructing the presentation from bridge elements"
                : "Opening in PowerPoint and exporting slide images"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SlidePanel({ label, labelClass, src, zoom }: {
  label: string; labelClass: string; src: string; zoom: number
}) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    setLoaded(false)
    setErrored(false)
  }, [src])

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-base overflow-auto scrollbar-thin">
      <div className="text-xs px-3 py-1 border-b border-edge bg-surface shrink-0">
        <span className={labelClass + " font-medium"}>{label}</span>
      </div>
      <div className="flex-1 flex items-start justify-center p-4 overflow-auto scrollbar-thin">
        {errored ? (
          <div className="flex flex-col items-center gap-2 text-muted text-sm mt-8">
            <span className="text-2xl">🚫</span>
            <span>Not available</span>
          </div>
        ) : (
          <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
            {!loaded && (
              <div className="w-64 h-48 rounded border border-edge bg-surface flex items-center
                              justify-center text-muted text-xs animate-pulse">
                Rendering…
              </div>
            )}
            <img
              src={src}
              alt={label}
              className={`max-w-none rounded shadow-lg border border-edge ${loaded ? "" : "hidden"}`}
              onLoad={() => setLoaded(true)}
              onError={() => { setErrored(true); setLoaded(true) }}
              style={{ maxWidth: "100%" }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
