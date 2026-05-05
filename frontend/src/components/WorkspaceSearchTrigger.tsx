import { useEffect, useState } from "react"
import WorkspaceSearch from "./WorkspaceSearch"

/**
 * Global Cmd-K / Ctrl-K binding. Mount once on each top-level workspace page
 * (Dashboard, Projects, Templates, Settings) and the search palette becomes
 * available everywhere outside the studio.
 *
 * Studio has its own slide-element command palette; that one stays.
 */

interface Props {
  orgId: string
  /** Visible button rendered in the parent's nav (optional). */
  triggerButton?: boolean
}

export default function WorkspaceSearchTrigger({ orgId, triggerButton }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Don't trigger inside text inputs/contenteditables — let editors keep their own bindings.
        const tgt = e.target as HTMLElement | null
        const inEditable = !!tgt && (
          tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable
        )
        if (inEditable) return
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      {triggerButton && (
        <button
          onClick={() => setOpen(true)}
          title="Search (⌘K)"
          className="flex items-center gap-2 text-[11px] text-muted hover:text-paper border border-edge hover:bg-paper/5 px-2.5 py-1.5 transition-colors"
        >
          <span className="text-base leading-none">⌕</span>
          <span>Search</span>
          <kbd className="text-[9px] tracking-[0.14em] uppercase text-muted/70 border border-edge px-1 py-0.5 ml-1">⌘K</kbd>
        </button>
      )}
      {open && <WorkspaceSearch orgId={orgId} onClose={() => setOpen(false)} />}
    </>
  )
}
