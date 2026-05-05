import { useEffect, useState } from "react"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { openProject, type Project } from "../lib/authApi"
import * as api from "../lib/api"
import type { DocInfo } from "../lib/types"
import Studio from "../components/studio/Studio"
import ThemeToggle from "../theme/ThemeToggle"
import Logo from "../components/Logo"
import PageLoader from "../components/PageLoader"

export default function StudioPage() {
  const { user, loading } = useAuth()
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [doc,     setDoc]     = useState<DocInfo | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [rebuilding, setRebuilding] = useState(false)

  useEffect(() => {
    if (!projectId || !user) return
    let cancelled = false
    setError(null); setDoc(null)
    ;(async () => {
      try {
        const { doc_id, project } = await openProject(projectId)
        if (cancelled) return
        setProject(project)
        const docs: DocInfo[] = await api.fetchDocs()
        const d = docs.find((dd) => dd.doc_id === doc_id)
        if (!d) throw new Error(`Doc ${doc_id} not found in workspace after open`)
        setDoc(d)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [projectId, user])

  const handleRebuild = async () => {
    if (!doc) return
    setRebuilding(true)
    try {
      await api.rebuildDoc(doc.doc_id)
    } catch (e) {
      console.error("rebuild:", e)
    } finally {
      setRebuilding(false)
    }
  }

  if (loading) {
    return <PageLoader />
  }
  if (!user) return <Navigate to="/login" replace />

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-base text-muted gap-3 p-4 text-center">
        <div className="text-bad text-sm">Could not open project</div>
        <div className="text-xs text-muted/70 max-w-md">{error}</div>
        <button
          onClick={() => navigate("/home")}
          className="text-xs px-3 py-1 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40"
        >Back to home</button>
      </div>
    )
  }
  if (!doc) {
    return <PageLoader caption="Opening project" />
  }

  return (
    <div className="h-screen flex flex-col bg-ink text-paper overflow-hidden">
      {/* top bar */}
      <div className="h-10 shrink-0 border-b border-edge bg-surface flex items-center px-4 gap-3 select-none">
        <button
          onClick={() => navigate("/home")}
          className="text-[10px] uppercase tracking-[0.16em] text-muted hover:text-paper flex items-center gap-1.5 transition-colors"
        >
          <span className="text-[12px] leading-none">←</span>
          <span>Home</span>
        </button>
        <span className="text-edge">/</span>
        <Logo size={14} />
        <span className="wordmark text-[10px]">Percy</span>
        <span className="text-edge">/</span>
        <span className="text-[12px] text-paper truncate flex-1 min-w-0">{project?.name ?? doc.name}</span>
        <ThemeToggle size="xs" />
      </div>
      <div className="flex flex-1 min-h-0">
        <Studio doc={doc} onRebuild={handleRebuild} rebuilding={rebuilding} />
      </div>
    </div>
  )
}
