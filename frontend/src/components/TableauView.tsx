import { useEffect, useState } from "react"
import type { DocInfo, TableauArtifact, TableauDoc } from "../lib/types"
import { captureAllTableauSheets, captureTableauArtifact, fetchTableauDoc, slideUrl, smartCaptureAllTableauSheets } from "../lib/api"
import { Camera, ChevronLeft, ChevronRight, Loader2, Sparkles, ZoomIn, ZoomOut } from "lucide-react"

interface Props {
  doc: DocInfo
  selectedArtifact: number
  onSelectArtifact: (n: number) => void
}

export default function TableauView({ doc, selectedArtifact, onSelectArtifact }: Props) {
  const [data, setData] = useState<TableauDoc | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchTableauDoc(doc.doc_id)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [doc.doc_id])

  const dashboards = (data?.artifacts ?? []).filter(a => a.kind === "dashboard")
  const worksheets = (data?.artifacts ?? []).filter(a => a.kind === "worksheet")
  // All navigable artifacts: dashboards first (they're the full composed view), then worksheets
  const allArtifacts = [...dashboards, ...worksheets]

  // Default to first dashboard if nothing selected yet
  const selected = allArtifacts.find(a => a.number === selectedArtifact)
    ?? dashboards[0]
    ?? worksheets[0]
    ?? null

  useEffect(() => {
    if (selected && selected.number !== selectedArtifact) {
      onSelectArtifact(selected.number)
    }
  }, [selected, selectedArtifact, onSelectArtifact])

  function prev() {
    const idx = allArtifacts.findIndex(a => a.number === selected?.number)
    if (idx > 0) onSelectArtifact(allArtifacts[idx - 1].number)
  }
  function next() {
    const idx = allArtifacts.findIndex(a => a.number === selected?.number)
    if (idx < allArtifacts.length - 1) onSelectArtifact(allArtifacts[idx + 1].number)
  }

  if (loading && !data) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted text-sm gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading workbook…
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-bad text-sm px-8 text-center">{error}</div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 bg-base">
      {/* ── sidebar ── */}
      <aside className="w-52 shrink-0 border-r border-edge bg-surface flex flex-col min-h-0">
        <div className="px-3 py-2.5 border-b border-edge shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-muted">Worksheets</p>
          <p className="text-xs font-semibold text-slate-200 truncate mt-0.5" title={doc.name}>{doc.name}</p>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
          {dashboards.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest text-muted font-semibold">Dashboards</p>
              {dashboards.map(ws => (
                <SidebarItem key={ws.number} artifact={ws} selected={selected} onSelect={onSelectArtifact} badge="D" />
              ))}
              <div className="mx-3 my-2 border-t border-edge" />
              <p className="px-3 pb-1 text-[9px] uppercase tracking-widest text-muted font-semibold">Worksheets</p>
            </>
          )}
          {worksheets.map(ws => (
            <SidebarItem key={ws.number} artifact={ws} selected={selected} onSelect={onSelectArtifact} />
          ))}
        </div>
      </aside>

      {/* ── main comparison area ── */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {selected ? (
          <ComparePanel
            doc={doc}
            artifact={selected}
            allArtifacts={allArtifacts}
            onPrev={prev}
            onNext={next}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted text-sm">
            No worksheets found
          </div>
        )}
      </div>
    </div>
  )
}

function SidebarItem({ artifact, selected, onSelect, badge }: {
  artifact: TableauArtifact
  selected: TableauArtifact | null
  onSelect: (n: number) => void
  badge?: string
}) {
  const active = artifact.number === selected?.number
  return (
    <button
      onClick={() => onSelect(artifact.number)}
      className={`w-full text-left px-3 py-2 text-xs border-l-2 transition-colors flex items-center gap-1.5 min-w-0 ${
        active
          ? "border-cyan-400 bg-cyan-400/10 text-cyan-100"
          : "border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
      title={artifact.name}
    >
      {badge && (
        <span className={`shrink-0 text-[8px] font-bold px-1 py-px rounded ${
          active ? "bg-cyan-400/20 text-cyan-300" : "bg-white/10 text-muted"
        }`}>{badge}</span>
      )}
      <span className="truncate">{artifact.name}</span>
    </button>
  )
}

function ComparePanel({
  doc, artifact, allArtifacts, onPrev, onNext,
}: {
  doc: DocInfo
  artifact: TableauArtifact
  allArtifacts: TableauArtifact[]
  onPrev: () => void
  onNext: () => void
}) {
  const [zoom, setZoom] = useState(1.0)
  const [capturing, setCapturing] = useState(false)
  const [capturingOne, setCapturingOne] = useState(false)
  const [smartCapturing, setSmartCapturing] = useState(false)
  const [captureKey, setCaptureKey] = useState(0)
  const [captureMsg, setCaptureMsg] = useState<string | null>(null)
  const [smartProgress, setSmartProgress] = useState<string | null>(null)

  const idx = allArtifacts.findIndex(a => a.number === artifact.number)
  const anyCapturing = capturing || capturingOne || smartCapturing

  async function captureAll() {
    setCapturing(true)
    setCaptureMsg(null)
    try {
      const r = await captureAllTableauSheets(doc.doc_id, 2.0)
      setCaptureKey(k => k + 1)
      setCaptureMsg(`✓ ${r.captured}/${r.total} captured`)
    } catch (e) {
      setCaptureMsg(`✗ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCapturing(false)
    }
  }

  async function captureThis() {
    setCapturingOne(true)
    setCaptureMsg(null)
    try {
      await captureTableauArtifact(doc.doc_id, artifact.number)
      setCaptureKey(k => k + 1)
      setCaptureMsg("✓ Captured")
    } catch (e) {
      setCaptureMsg(`✗ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCapturingOne(false)
    }
  }

  async function smartCaptureAll() {
    setSmartCapturing(true)
    setCaptureMsg(null)
    setSmartProgress("Opening Tableau Desktop…")
    try {
      const r = await smartCaptureAllTableauSheets(doc.doc_id, {
        maxRenderWait: 12,
        useVision: true,
        maxRetries: 3,
      })
      setCaptureKey(k => k + 1)
      const results = r.results as Array<Record<string, unknown>>
      const good = results.filter(x => (x.quality_score as number) >= 14).length
      const vOk  = results.filter(x => (x.vision as Record<string, unknown>)?.ok === true).length
      setCaptureMsg(`✓ ${r.captured}/${r.total} captured · ${good} high-quality · ${vOk} vision-verified`)
    } catch (e) {
      setCaptureMsg(`✗ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSmartCapturing(false)
      setSmartProgress(null)
    }
  }

  // Reset capture message when switching worksheets
  useEffect(() => { setCaptureMsg(null) }, [artifact.number])

  const nativeSrc = `${slideUrl.tableauArtifactCapture(doc.doc_id, artifact.number)}?v=${captureKey}`
  const bridgeSrc = `${slideUrl.bridge(doc.doc_id, artifact.number)}?v=${doc.doc_id}`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-edge bg-surface shrink-0 flex-wrap">
        {/* navigation */}
        <button
          onClick={onPrev}
          disabled={idx <= 0}
          className="p-1 rounded hover:bg-white/10 text-muted disabled:opacity-30"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-medium text-slate-200 truncate max-w-[200px]" title={artifact.title || artifact.name}>
          {artifact.title || artifact.name}
        </span>
        {artifact.kind === "dashboard" && (
          <span className="text-[9px] font-bold px-1.5 py-px rounded bg-cyan-400/15 text-cyan-300 shrink-0">DASHBOARD</span>
        )}
        <span className="text-xs text-muted shrink-0">{idx + 1} / {allArtifacts.length}</span>
        <button
          onClick={onNext}
          disabled={idx >= allArtifacts.length - 1}
          className="p-1 rounded hover:bg-white/10 text-muted disabled:opacity-30"
        >
          <ChevronRight size={14} />
        </button>

        <div className="h-4 w-px bg-edge mx-1" />

        {/* capture buttons */}
        <button
          onClick={captureThis}
          disabled={anyCapturing}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-cyan-400/40 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50"
        >
          {capturingOne ? <Loader2 size={10} className="animate-spin" /> : <Camera size={10} />}
          Capture this
        </button>
        <button
          onClick={captureAll}
          disabled={anyCapturing}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-edge text-muted hover:bg-white/5 disabled:opacity-50"
        >
          {capturing ? <Loader2 size={10} className="animate-spin" /> : <Camera size={10} />}
          Capture all
        </button>
        <button
          onClick={smartCaptureAll}
          disabled={anyCapturing}
          title="Stability detection + pixel quality check + LM Studio vision verification"
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-violet-400/40 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20 disabled:opacity-50"
        >
          {smartCapturing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
          Smart capture all
        </button>
        {smartProgress && (
          <span className="text-[10px] text-violet-300 animate-pulse">{smartProgress}</span>
        )}
        {captureMsg && !smartProgress && (
          <span className={`text-[10px] ${captureMsg.startsWith("✓") ? "text-good" : "text-bad"}`}>
            {captureMsg}
          </span>
        )}

        {/* zoom */}
        <div className="flex items-center gap-1 ml-auto">
          <button className="p-1 rounded hover:bg-white/10 text-muted" onClick={() => setZoom(z => Math.max(0.3, z - 0.15))}>
            <ZoomOut size={13} />
          </button>
          <span className="text-xs text-muted w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button className="p-1 rounded hover:bg-white/10 text-muted" onClick={() => setZoom(z => Math.min(2.5, z + 0.15))}>
            <ZoomIn size={13} />
          </button>
          <button className="text-xs px-2 py-0.5 rounded border border-edge text-muted ml-1 hover:bg-white/10" onClick={() => setZoom(1.0)}>
            Reset
          </button>
        </div>
      </div>

      {/* panels */}
      <div className="flex flex-1 min-h-0 gap-px bg-edge overflow-hidden">
        <ImagePanel label="Native Tableau" labelClass="text-cyan-300" src={nativeSrc} zoom={zoom}
          placeholder="No screenshot yet — click «Capture this», «Capture all», or «Smart capture all»" />
        <ImagePanel label="Bridge Render" labelClass="text-accent-light" src={bridgeSrc} zoom={zoom} />
      </div>
    </div>
  )
}

function ImagePanel({
  label, labelClass, src, zoom, placeholder,
}: {
  label: string; labelClass: string; src: string; zoom: number; placeholder?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  useEffect(() => { setLoaded(false); setErrored(false) }, [src])

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-base overflow-auto scrollbar-thin">
      <div className="text-xs px-3 py-1 border-b border-edge bg-surface shrink-0 flex items-center gap-2">
        <span className={labelClass + " font-medium"}>{label}</span>
      </div>
      <div className="flex-1 flex items-start justify-center p-4 overflow-auto scrollbar-thin">
        {errored ? (
          <div className="flex flex-col items-center gap-3 text-muted mt-16">
            <Camera size={28} className="opacity-30" />
            <p className="text-xs text-center max-w-44 leading-relaxed">
              {placeholder ?? "Not available"}
            </p>
          </div>
        ) : (
          <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
            {!loaded && (
              <div className="w-64 h-48 rounded border border-edge bg-surface flex items-center justify-center text-muted text-xs animate-pulse">
                Loading…
              </div>
            )}
            <img
              src={src}
              alt={label}
              className={`max-w-none rounded shadow border border-edge ${loaded ? "" : "hidden"}`}
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
