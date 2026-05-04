import { useRef } from "react"
import type { WorkspaceFile, DocInfo } from "../lib/types"
import { FileText, Play, RefreshCw, ChevronRight, ImageIcon, BarChart3, Upload } from "lucide-react"

interface Props {
  workspace: WorkspaceFile[]
  docs: DocInfo[]
  selectedDocId: string | null
  onLoad: (path: string) => void
  onRebuild: (docId: string) => void
  onRerender: (docId: string) => void
  onSelectDoc: (docId: string) => void
  onRefreshWorkspace: () => void
  disabled: boolean
  rebuildPhase: "building" | "rendering" | null
}

export default function FileSidebar({
  workspace, docs, selectedDocId, onLoad, onRebuild, onRerender, onSelectDoc, onRefreshWorkspace, disabled, rebuildPhase,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append("file", file)
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form })
      if (!res.ok) throw new Error(await res.text())
      onRefreshWorkspace()
    } catch (err) {
      alert(`Upload failed: ${err}`)
    } finally {
      e.target.value = ""
    }
  }

  const pptxFiles = workspace.filter(f => !f.format || f.format === "pptx")
  const pdfFiles  = workspace.filter(f => f.format === "pdf")
  const tableauFiles = workspace.filter(f => f.format === "tableau")

  return (
    <aside className="w-64 shrink-0 flex flex-col border-r border-edge bg-surface overflow-hidden">
      {/* Upload button */}
      <div className="px-3 py-2 border-b border-edge">
        <input ref={fileInputRef} type="file" accept=".pptx,.pdf,.twbx,.twb" className="hidden" onChange={handleUpload} />
        <button
          className="btn-xs w-full flex items-center gap-1 justify-center"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={10} /> Upload File
        </button>
      </div>

      {/* PPTX files */}
      <Section title="PPTX Files" count={pptxFiles.length}>
        {pptxFiles.length === 0 ? (
          <p className="text-muted text-xs px-3 py-2">
            No .pptx files found in <code className="text-slate-400">outreach/dump_pptx</code> or <code className="text-slate-400">manual_dump_pptx</code>
          </p>
        ) : (
          pptxFiles.map(f => (
            <FileRow
              key={f.path}
              name={f.name}
              meta={`${f.size_kb} KB`}
              action={
                <button
                  className="btn-xs"
                  disabled={disabled}
                  onClick={() => onLoad(f.path)}
                  title={f.path}
                >
                  <Play size={10} /> Load
                </button>
              }
            />
          ))
        )}
      </Section>

      {/* PDF files */}
      <Section title="PDF Files" count={pdfFiles.length}>
        {pdfFiles.length === 0 ? (
          <p className="text-muted text-xs px-3 py-2">
            No .pdf files found in workspace folders
          </p>
        ) : (
          pdfFiles.map(f => (
            <FileRow
              key={f.path}
              name={f.name}
              meta={`${f.size_kb} KB`}
              action={
                <button
                  className="btn-xs"
                  disabled={disabled}
                  onClick={() => onLoad(f.path)}
                  title={f.path}
                >
                  <Play size={10} /> Load
                </button>
              }
            />
          ))
        )}
      </Section>

      <Section title="Tableau Files" count={tableauFiles.length}>
        {tableauFiles.length === 0 ? (
          <p className="text-muted text-xs px-3 py-2">
            No .twb or .twbx files found in workspace folders or Downloads
          </p>
        ) : (
          tableauFiles.map(f => (
            <FileRow
              key={f.path}
              name={f.name}
              icon={<BarChart3 size={12} className="shrink-0 text-muted" />}
              meta={`${f.size_kb} KB`}
              action={
                <button
                  className="btn-xs"
                  disabled={disabled}
                  onClick={() => onLoad(f.path)}
                  title={f.path}
                >
                  <Play size={10} /> Load
                </button>
              }
            />
          ))
        )}
      </Section>

      {/* Loaded docs */}
      <Section title="Loaded Docs" count={docs.length}>
        {docs.length === 0 ? (
          <p className="text-muted text-xs px-3 py-2">No documents loaded yet</p>
        ) : (
          docs.map(d => {
            const active = d.doc_id === selectedDocId
            return (
              <div
                key={d.doc_id}
                className={`group flex items-start gap-2 px-3 py-2 cursor-pointer border-l-2 transition-colors
                  ${active ? "border-accent bg-accent/10" : "border-transparent hover:bg-white/5"}`}
                onClick={() => onSelectDoc(d.doc_id)}
              >
                {d.source_format === "tableau"
                  ? <BarChart3 size={13} className="mt-0.5 shrink-0 text-muted" />
                  : <FileText size={13} className="mt-0.5 shrink-0 text-muted" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate text-slate-300" title={d.name}>
                    {d.name}
                  </p>
                  <p className="text-xs text-muted">
                    {d.slide_count} {d.source_format === "tableau" ? "artifacts" : d.source_format === "pdf" ? "pages" : "slides"}
                    {d.source_format === "pdf" && (
                      <span className="ml-1 px-1 rounded text-[10px] bg-orange-900/40 text-orange-300 font-semibold">PDF</span>
                    )}
                    {d.source_format === "tableau" && (
                      <span className="ml-1 px-1 rounded text-[10px] bg-cyan-900/40 text-cyan-300 font-semibold">TABLEAU</span>
                    )}
                    {d.has_originals && <span className="ml-1 text-good">· orig</span>}
                    {d.has_rebuild && <span className="ml-1 text-accent-light">· rebuilt</span>}
                  </p>
                  {(d.grade_summary || d.diagnostic_summary) && (
                    <p className="text-xs text-muted">
                      {d.grade_summary?.graded ?? 0}/{d.slide_count} reviewed
                      <span className={d.diagnostic_summary?.total ? "ml-1 text-partial" : "ml-1 text-good"}>
                        Â· {d.diagnostic_summary?.total ?? 0} diag
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {active && (
                    <>
                      {d.source_format === "pptx" && (
                        <button
                          className={`btn-xs border transition-colors ${
                            rebuildPhase === "building"
                              ? "bg-amber-900/40 text-amber-300 border-amber-700/50 cursor-wait"
                              : rebuildPhase === "rendering"
                              ? "bg-sky-900/40 text-sky-300 border-sky-700/50 cursor-wait"
                              : "bg-accent/20 hover:bg-accent/40 text-accent-light border-accent/30"
                          }`}
                          disabled={disabled}
                          onClick={e => { e.stopPropagation(); onRebuild(d.doc_id) }}
                        >
                          <RefreshCw size={9} className={rebuildPhase ? "animate-spin" : ""} />
                          {rebuildPhase === "building"
                            ? "Building…"
                            : rebuildPhase === "rendering"
                            ? "Rendering…"
                            : d.has_rebuild ? "Re-rebuild" : "Rebuild"}
                        </button>
                      )}
                      <button
                        className="btn-xs"
                        disabled={disabled}
                        onClick={e => { e.stopPropagation(); onRerender(d.doc_id) }}
                        title="Re-render bridge slides (after renderer code changes)"
                      >
                        <ImageIcon size={9} />
                        Re-render
                      </button>
                    </>
                  )}
                  {active && <ChevronRight size={12} className="text-accent self-end" />}
                </div>
              </div>
            )
          })
        )}
      </Section>

      {/* footer hint */}
      <div className="mt-auto px-3 py-2 border-t border-edge">
        <p className="text-xs text-muted leading-relaxed">
          Grades are saved per session. Export via Diagnostics panel.
        </p>
      </div>
    </aside>
  )
}

function Section({ title, count, children }: {
  title: string; count: number; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col min-h-0 border-b border-edge">
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted">{title}</span>
        <span className="text-xs text-muted bg-base rounded px-1">{count}</span>
      </div>
      <div className="overflow-y-auto scrollbar-thin max-h-52">{children}</div>
    </div>
  )
}

function FileRow({ name, meta, action, icon }: {
  name: string; meta: string; action: React.ReactNode; icon?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5">
      {icon ?? <FileText size={12} className="shrink-0 text-muted" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs truncate text-slate-300" title={name}>{name}</p>
        <p className="text-xs text-muted">{meta}</p>
      </div>
      {action}
    </div>
  )
}
