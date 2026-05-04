import { useState, useEffect, useCallback, useRef } from "react"
import type {
  WorkspaceFile, DocInfo, Diagnostic, Grade, DocSummary, HistoryDoc, VisionGradeResult,
} from "./lib/types"
import * as api from "./lib/api"
import FileSidebar from "./components/FileSidebar"
import SlideStrip from "./components/SlideStrip"
import CompareView from "./components/CompareView"
import TableauView from "./components/TableauView"
import DiagPanel from "./components/DiagPanel"
import LogPanel from "./components/LogPanel"
import { log } from "./lib/logger"

export default function App() {
  const [workspace, setWorkspace]         = useState<WorkspaceFile[]>([])
  const [docs, setDocs]                   = useState<DocInfo[]>([])
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [selectedSlide, setSelectedSlide] = useState(1)
  const [diagnostics, setDiagnostics]     = useState<Diagnostic[]>([])
  const [grades, setGrades]               = useState<Record<number, Grade>>({})
  const [summary, setSummary]             = useState<DocSummary | null>(null)
  const [history, setHistory]             = useState<HistoryDoc[]>([])
  const [pixelScores, setPixelScores]     = useState<Record<number, number>>({})
  const [visionResult, setVisionResult]   = useState<VisionGradeResult | null>(null)
  const [visionLoading, setVisionLoading] = useState<"bridge" | "rebuilt" | null>(null)
  const [loading, setLoading]             = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)
  const [bridgeVer, setBridgeVer]         = useState(0)
  const [renderPending, setRenderPending] = useState<string | null>(null)
  const [rebuildPhase, setRebuildPhase]   = useState<"building" | "rendering" | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedDoc = docs.find(d => d.doc_id === selectedDocId) ?? null
  const diagnosticCounts = diagnostics.reduce<Record<number, number>>((acc, diag) => {
    if (diag.slide_number) acc[diag.slide_number] = (acc[diag.slide_number] ?? 0) + 1
    return acc
  }, {})

  const refreshEvaluation = useCallback(async (docId: string) => {
    const [diags, g, s, h] = await Promise.all([
      api.fetchDiagnostics(docId),
      api.fetchGrades(docId),
      api.fetchSummary(docId),
      api.fetchHistory(),
    ])
    setDiagnostics(diags)
    setGrades(g)
    setSummary(s)
    setHistory(h)
    return { diags, grades: g, summary: s }
  }, [])

  // Poll render-status after onboard/rebuild until COM renders are ready
  useEffect(() => {
    if (!renderPending) return
    const poll = async () => {
      try {
        const status = await api.fetchRenderStatus(renderPending)
        const needsOriginals = !status.has_originals
        const needsRebuilt  = status.has_rebuild && !status.has_rebuilt_renders
        if (!needsOriginals && !needsRebuilt) {
          setRenderPending(null)
          setRebuildPhase(null)
          if (status.pixel_scores && Object.keys(status.pixel_scores).length > 0) {
            const scores: Record<number, number> = {}
            for (const [k, v] of Object.entries(status.pixel_scores)) scores[Number(k)] = v
            setPixelScores(scores)
          }
          const updated = await api.fetchDocs()
          setDocs(updated)
          setBridgeVer(v => v + 1)
          await refreshEvaluation(renderPending).catch(() => {})
          log("success", `COM renders ready for doc_id=${renderPending}`)
          return
        }
        const what = [needsOriginals && "original", needsRebuilt && "rebuilt"].filter(Boolean).join(", ")
        log("info", `Waiting for COM renders (${what})…`)
      } catch (e: unknown) {
        // Stop polling if the doc was evicted (server restart cleared memory)
        if (e instanceof Error && (e as any).is404) {
          log("error", "Render poll: doc evicted (server restarted?) — stopping poll")
          setRenderPending(null)
          setRebuildPhase(null)
          return
        }
      }
      pollTimer.current = setTimeout(poll, 5000)
    }
    pollTimer.current = setTimeout(poll, 5000)
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current) }
  }, [renderPending, refreshEvaluation])

  useEffect(() => {
    api.fetchWorkspace()
      .then(files => { setWorkspace(files); log("success", `Workspace: ${files.length} PPTX files found`) })
      .catch(e => log("error", "fetchWorkspace failed", String(e)))
    api.fetchDocs()
      .then(d => { setDocs(d); log("info", `Loaded docs: ${d.length}`) })
      .catch(() => {})
    api.fetchHistory()
      .then(h => setHistory(h))
      .catch(() => {})
  }, [refreshEvaluation])

  const handleLoad = useCallback(async (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path
    log("info", `Loading: ${name}`)
    setLoading(`Onboarding ${name}…`)
    setError(null)
    try {
      const result = await api.onboardDoc(path)
      const unit = result.source_format === "tableau" ? "artifacts" : result.source_format === "pdf" ? "pages" : "slides"
      log("success", `Onboarded: ${result.slide_count} ${unit}, originals=${result.has_originals}`, result)
      const updated = await api.fetchDocs()
      setDocs(updated)
      setSelectedDocId(result.doc_id)
      setSelectedSlide(1)
      setGrades({})
      setDiagnostics([])
      setSummary(null)
      setVisionResult(null)
      setPixelScores({})
      setBridgeVer(0)
      await refreshEvaluation(result.doc_id).catch(() => {})
      if (result.source_format === "pptx") {
        setRenderPending(result.doc_id)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log("error", `Onboard failed: ${msg}`)
      setError(msg)
    } finally {
      setLoading(null)
    }
  }, [refreshEvaluation])

  const handleRebuild = useCallback(async (docId: string) => {
    log("info", `Rebuilding doc_id=${docId}`)
    setLoading(null)
    setRebuildPhase("building")
    setError(null)
    try {
      const result = await api.rebuildDoc(docId)
      log("success", `Rebuild done: ${result.diagnostic_count} diagnostics — COM renders running in background`, result)
      const [updated, evalState] = await Promise.all([
        api.fetchDocs(),
        refreshEvaluation(docId),
      ])
      setDocs(updated)
      log("info", `Diagnostics loaded: ${evalState.diags.length} issues`)
      setRebuildPhase("rendering")
      setRenderPending(docId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log("error", `Rebuild failed: ${msg}`)
      setError(msg)
      setRebuildPhase(null)
    }
  }, [refreshEvaluation])

  const handleSelectDoc = useCallback(async (docId: string) => {
    log("info", `Selected doc: ${docId}`)
    setSelectedDocId(docId)
    setSelectedSlide(1)
    setDiagnostics([])
    setGrades({})
    setSummary(null)
    setVisionResult(null)
    setPixelScores({})
    try {
      const state = await refreshEvaluation(docId)
      log("info", `Doc state: ${state.diags.length} diagnostics, ${Object.keys(state.grades).length} grades`)
    } catch {
      // not yet rebuilt — diagnostics won't be available
    }
  }, [])

  const handleRerender = useCallback(async (docId: string) => {
    log("info", `Re-rendering bridge slides for doc_id=${docId}`)
    setLoading("Re-rendering bridge slides…")
    setError(null)
    try {
      const result = await api.rerenderBridge(docId)
      log("success", `Re-render done: ${result.bridge_slides} slides`, result)
      setBridgeVer(v => v + 1)
      await refreshEvaluation(docId).catch(() => {})
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log("error", `Re-render failed: ${msg}`)
      setError(msg)
    } finally {
      setLoading(null)
    }
  }, [refreshEvaluation])

  const handleGrade = useCallback(async (slideN: number, grade: Grade) => {
    if (!selectedDocId) return
    log("info", `Grade slide ${slideN}: ${grade}`)
    const next = { ...grades, [slideN]: grade }
    setGrades(next)
    api.setGrade(selectedDocId, slideN, grade)
      .then(() => refreshEvaluation(selectedDocId).catch(() => {}))
      .catch(() => {})
  }, [selectedDocId, grades, refreshEvaluation])

  const handleVisionGrade = useCallback(async (slideN: number, target: "bridge" | "rebuilt") => {
    if (!selectedDocId) return
    setVisionLoading(target)
    setError(null)
    log("info", `Vision grading slide ${slideN} vs ${target}`)
    try {
      const result = await api.visionGradeSlide(selectedDocId, slideN, target)
      setVisionResult(result)
      await refreshEvaluation(selectedDocId).catch(() => {})
      log("success", `Vision grade done: slide ${slideN} vs ${target}`, result)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log("error", `Vision grade failed: ${msg}`)
      setError(msg)
    } finally {
      setVisionLoading(null)
    }
  }, [selectedDocId, refreshEvaluation])

  const headerStatus = rebuildPhase === "building"
    ? { color: "text-amber-400", spin: "border-amber-400", msg: "Building PPTX from bridge data…" }
    : rebuildPhase === "rendering"
    ? { color: "text-sky-400",   spin: "border-sky-400",   msg: "Rendering slides via PowerPoint…" }
    : loading
    ? { color: "text-slate-400", spin: "border-accent",    msg: loading }
    : null

  return (
    <div className="flex flex-col h-screen bg-base text-slate-200 overflow-hidden">
      {/* ── header ─────────────────────────────────────────── */}
      <header className="h-11 flex items-center px-4 border-b border-edge bg-surface shrink-0 gap-3">
        <span className="text-accent font-bold text-base tracking-tight">PERCY</span>
        <span className="text-muted text-xs uppercase tracking-widest">Roundtrip Studio</span>
        {headerStatus && (
          <div className={`ml-auto flex items-center gap-2 text-xs ${headerStatus.color}`}>
            <span className={`inline-block w-3 h-3 border-2 ${headerStatus.spin} border-t-transparent rounded-full animate-spin`} />
            {headerStatus.msg}
          </div>
        )}
        {error && !headerStatus && (
          <div className="ml-auto text-xs text-bad truncate max-w-xs" title={error}>
            ⚠ {error}
          </div>
        )}
      </header>

      {/* ── body ───────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        <FileSidebar
          workspace={workspace}
          docs={docs}
          selectedDocId={selectedDocId}
          onLoad={handleLoad}
          onRebuild={handleRebuild}
          onRerender={handleRerender}
          onSelectDoc={handleSelectDoc}
          disabled={!!loading || !!rebuildPhase}
          rebuildPhase={rebuildPhase}
        />

        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {selectedDoc ? (
            selectedDoc.source_format === "tableau" ? (
              <TableauView
                doc={selectedDoc}
                selectedArtifact={selectedSlide}
                onSelectArtifact={setSelectedSlide}
              />
            ) : (
              <>
                <SlideStrip
                  docId={selectedDoc.doc_id}
                  slideCount={selectedDoc.slide_count}
                  selectedSlide={selectedSlide}
                  grades={grades}
                  diagnosticCounts={diagnosticCounts}
                  pixelScores={pixelScores}
                  cacheBust={bridgeVer}
                  onSelect={setSelectedSlide}
                />
                <CompareView
                  doc={selectedDoc}
                  slideN={selectedSlide}
                  grades={grades}
                  pixelScores={pixelScores}
                  cacheBust={bridgeVer}
                  onGrade={handleGrade}
                  onVisionGrade={handleVisionGrade}
                  visionResult={visionResult}
                  visionLoading={visionLoading}
                  rebuildPhase={rebuildPhase}
                />
              </>
            )
          ) : (
            <EmptyState />
          )}
        </div>

        <DiagPanel
          doc={selectedDoc}
          slideN={selectedSlide}
          diagnostics={diagnostics}
          grades={grades}
          summary={summary}
          history={history}
          onSelectSlide={setSelectedSlide}
        />
      </div>

      {/* ── activity log ───────────────────────────────────── */}
      <LogPanel />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center px-10">
      <div className="text-5xl mb-3">📊</div>
      <p className="text-slate-300 font-semibold text-lg">Percy Roundtrip Studio</p>
      <p className="text-muted text-sm max-w-sm leading-relaxed">
        Select a <strong className="text-slate-400">.pptx</strong>, <strong className="text-slate-400">.pdf</strong>, or <strong className="text-slate-400">.twbx</strong> file
        from the left panel and click <strong className="text-slate-400">Load</strong> to onboard it.
        For PPTX files, click <strong className="text-slate-400">Rebuild</strong> to generate the roundtrip
        and compare slides side-by-side.
      </p>
    </div>
  )
}
