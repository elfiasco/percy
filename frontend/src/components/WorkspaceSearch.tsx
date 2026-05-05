import { useEffect, useRef, useState, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import {
  listProjects, listFolders, listTemplates,
  type Project, type Folder, type Template,
} from "../lib/authApi"

/**
 * WorkspaceSearch — a Cmd+K palette for finding projects, folders, and
 * templates within the current org without leaving whatever page you're on.
 *
 * Loads the org's items once on open (cached in component state), filters
 * locally on every keystroke. For very large workspaces this would want a
 * server-side index; for the current scale, in-memory is fast enough.
 */

interface Props {
  orgId:    string
  onClose:  () => void
}

type Result =
  | { kind: "project";  project: Project;   score: number }
  | { kind: "folder";   folder:  Folder;    score: number }
  | { kind: "template"; template: Template; score: number }

export default function WorkspaceSearch({ orgId, onClose }: Props) {
  const [query, setQuery] = useState("")
  const [projects, setProjects]   = useState<Project[]>([])
  const [folders,  setFolders]    = useState<Folder[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading]     = useState(true)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Load corpus once on open
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      listProjects(orgId).catch(() => ({ projects: [] })),
      listFolders(orgId).catch(() => ({ folders: [] })),
      listTemplates(orgId).catch(() => ({ templates: [] })),
    ]).then(([p, f, t]) => {
      if (cancelled) return
      setProjects(p.projects)
      setFolders(f.folders)
      setTemplates(t.templates)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [orgId])

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30) }, [])

  // Score every item against the query (substring + small bonus for prefix match)
  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      // No query: surface recents (top 8 by updated_at)
      return projects
        .slice()
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, 8)
        .map((p) => ({ kind: "project" as const, project: p, score: 1 }))
    }
    const hits: Result[] = []
    for (const p of projects) {
      const s = score(p.name, q)
      if (s > 0) hits.push({ kind: "project", project: p, score: s })
    }
    for (const f of folders) {
      const s = score(f.name, q)
      if (s > 0) hits.push({ kind: "folder", folder: f, score: s })
    }
    for (const t of templates) {
      const s = score(t.name, q)
      if (s > 0) hits.push({ kind: "template", template: t, score: s })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, 30)
  }, [query, projects, folders, templates])

  // reset cursor when results change
  useEffect(() => { setActiveIdx(0) }, [results])

  const open = useCallback((r: Result) => {
    if (r.kind === "project") {
      if (r.project.doc_source) navigate(`/studio/${r.project.id}`)
      else                       navigate(`/project/${r.project.id}`)
    } else if (r.kind === "folder") {
      navigate(`/projects`)
    } else {
      navigate(`/templates?org=${orgId}&t=${r.template.id}`)
    }
    onClose()
  }, [navigate, orgId, onClose])

  return (
    <div
      className="fixed inset-0 z-[1700] flex items-start justify-center pt-[15vh] px-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-surface border border-edge shadow-2xl flex flex-col max-h-[60vh]"
        style={{ background: "rgb(var(--surface))" }}
      >
        {/* input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-edge">
          <span className="text-muted text-base">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); return }
              if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); return }
              if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return }
              if (e.key === "Enter")     { e.preventDefault(); const r = results[activeIdx]; if (r) open(r); return }
            }}
            placeholder="Search projects, folders, templates…"
            className="flex-1 text-[14px] bg-transparent text-paper focus:outline-none placeholder:text-muted/60"
          />
          <kbd className="text-[10px] tracking-[0.14em] uppercase text-muted/70 border border-edge px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* results */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center text-[12px] text-muted">Loading workspace…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-muted">
              {query ? `No matches for "${query}".` : "Nothing yet — start a project to populate this."}
            </div>
          ) : (
            <div>
              {!query && (
                <div className="px-4 pt-3 pb-1 text-[9px] tracking-[0.18em] uppercase text-muted/70">Recent</div>
              )}
              {results.map((r, i) => (
                <ResultRow key={resultKey(r)}
                  result={r}
                  active={i === activeIdx}
                  onClick={() => open(r)}
                  onHover={() => setActiveIdx(i)}
                />
              ))}
            </div>
          )}
        </div>

        {/* footer hints */}
        <div className="px-4 py-2 border-t border-edge flex items-center gap-3 text-[10px] tracking-[0.14em] uppercase text-muted/70">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <div className="flex-1" />
          <span>{results.length} {results.length === 1 ? "result" : "results"}</span>
        </div>
      </div>
    </div>
  )
}

function ResultRow({
  result, active, onClick, onHover,
}: {
  result: Result; active: boolean; onClick: () => void; onHover: () => void
}) {
  const { name, kind, sub } = describe(result)
  const icon = kind === "project" ? "▢" : kind === "folder" ? "▣" : "✦"
  return (
    <button
      onClick={onClick}
      onMouseMove={onHover}
      className={`w-full text-left flex items-center gap-3 px-4 py-2 transition-colors ${
        active ? "bg-paper/10" : "hover:bg-paper/5"
      }`}
    >
      <span className={`shrink-0 text-base ${active ? "text-paper" : "text-muted"}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-paper truncate">{name}</div>
        <div className="text-[10px] tracking-[0.14em] uppercase text-muted">{sub}</div>
      </div>
      {active && <span className="text-[10px] text-muted">↵</span>}
    </button>
  )
}

function describe(r: Result): { name: string; kind: string; sub: string } {
  if (r.kind === "project") {
    return {
      name: r.project.name,
      kind: "project",
      sub: r.project.doc_source ? "Project · open in Studio" : "Project · no source yet",
    }
  }
  if (r.kind === "folder") {
    return { name: r.folder.name, kind: "folder", sub: "Folder" }
  }
  return {
    name: r.template.name,
    kind: "template",
    sub: `${r.template.scope === "team" ? "Team " : ""}Template · ${r.template.source_project_ids.length} sources`,
  }
}

function resultKey(r: Result): string {
  if (r.kind === "project")  return `p:${r.project.id}`
  if (r.kind === "folder")   return `f:${r.folder.id}`
  return                          `t:${r.template.id}`
}

function score(name: string, q: string): number {
  const n = name.toLowerCase()
  if (n === q)        return 100
  if (n.startsWith(q)) return 50
  if (n.includes(q))   return 20
  // Tokenized partial match
  const tokens = n.split(/\s+/)
  if (tokens.some((t) => t.startsWith(q))) return 10
  return 0
}
