import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { getActiveSetForProject, type ActiveSetResponse } from "../lib/templateSetsApi"

/**
 * TemplateSetBadge — compact chip in the Studio header that shows which
 * Template Set the agent is currently honouring for the open project, and
 * where it was inherited from (project's folder, parent folder, or org
 * default). Click → /template-sets/:setId.
 *
 * Renders nothing if the project has no active set anywhere in its chain.
 */
export default function TemplateSetBadge({ projectId }: { projectId: string | undefined | null }) {
  const [resolved, setResolved] = useState<ActiveSetResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!projectId) { setResolved(null); return }
    let cancelled = false
    getActiveSetForProject(projectId)
      .then((r) => { if (!cancelled) setResolved(r) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [projectId])

  if (error || !resolved || !resolved.set) return null

  const set = resolved.set
  const inherited = resolved.inherited_from
  // Friendly label: don't expose folder ids in the chip — keep it short.
  const inheritLabel =
    inherited === "project_folder" ? "team override"
    : inherited === "org_default" ? "org default"
    : inherited.startsWith("parent_folder:") ? "team override"
    : ""

  return (
    <Link
      to={`/template-sets/${set.id}`}
      title={`Active Template Set: ${set.name} (${inheritLabel || "active"}) — click to manage`}
      className="text-[10px] uppercase tracking-[0.16em] px-2 py-1 border border-edge text-muted hover:text-accent hover:border-accent transition-colors flex items-center gap-1.5 max-w-[200px] truncate"
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <line x1="1.5" y1="6" x2="14.5" y2="6" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <span className="truncate">{set.name}</span>
    </Link>
  )
}
