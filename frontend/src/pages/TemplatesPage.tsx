import { useState, useEffect, useCallback } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import {
  listOrgTemplateSets, createTemplateSet, setAsDefault,
  type TemplateSet,
} from "../lib/templateSetsApi"
import Logo from "../components/Logo"
import ThemeToggle from "../theme/ThemeToggle"
import { useToast } from "../components/Toaster"
import WorkspaceSearchTrigger from "../components/WorkspaceSearchTrigger"
import PageLoader from "../components/PageLoader"

/**
 * TemplatesPage — the Template Sets index.
 *
 * Every workspace member lands here to:
 *   - See the Percy Standard built-in set + their org's own sets
 *   - Create a new set
 *   - Mark a set as the org default
 *   - Click into the 5-tab editor at /template-sets/:setId for the deep work
 *
 * The 5-tab editor (Slides / Elements / Brand / Instructions / Refs / Python)
 * lives at /template-sets/:setId. This page is intentionally a flat,
 * scannable list — no editor surface inline.
 *
 * URL: /templates?org=<id>
 */

export default function TemplatesPage() {
  const { user, loading } = useAuth()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()

  const orgIdFromUrl = params.get("org")
  const activeOrg = user?.orgs.find((o) => o.id === orgIdFromUrl) ?? user?.orgs[0]

  const [sets, setSets] = useState<TemplateSet[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    if (!activeOrg) return
    try {
      const r = await listOrgTemplateSets(activeOrg.id)
      setSets(r.template_sets)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeOrg])

  useEffect(() => { refresh() }, [refresh])

  // Keep URL in sync with active org
  useEffect(() => {
    if (activeOrg && orgIdFromUrl !== activeOrg.id) {
      setParams({ org: activeOrg.id })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id])

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (!activeOrg) {
    return <div className="min-h-screen flex items-center justify-center bg-ink text-muted text-sm">No workspace.</div>
  }

  const builtin = (sets || []).filter((s) => s.is_builtin)
  const orgSets = (sets || []).filter((s) => !s.is_builtin)

  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper">
      {/* top bar */}
      <div className="h-12 shrink-0 border-b border-edge bg-surface flex items-center justify-between px-5 select-none">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/home")}
            className="text-[10px] uppercase tracking-[0.16em] text-muted hover:text-paper flex items-center gap-1.5 transition-colors">
            <span className="text-[12px] leading-none">←</span><span>Home</span>
          </button>
          <span className="text-edge">/</span>
          <Link to="/home" className="flex items-center gap-2.5">
            <Logo size={16} />
            <span className="wordmark text-[12px]">Percy</span>
          </Link>
          <span className="text-edge">/</span>
          <span className="text-[12px] text-paper">Template Sets</span>
          <span className="text-muted">·</span>
          <span className="text-[12px] text-muted">{activeOrg.name}</span>
        </div>
        <WorkspaceSearchTrigger orgId={activeOrg.id} triggerButton />
        <ThemeToggle size="xs" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">
          {/* Intro */}
          <div className="mb-8">
            <h1 className="text-[28px] font-medium text-paper mb-2">Template Sets</h1>
            <p className="text-[13px] text-muted leading-relaxed max-w-2xl">
              A Template Set bundles your team's slide templates, element library,
              brand palette, fonts, instructions, and reference docs into one package.
              Percy uses the active set to style every deck the agent creates or edits —
              and to generate a typed Python module your scripts can import.
            </p>
          </div>

          {error && (
            <div className="border border-brick/40 bg-brick/5 text-brick p-3 mb-6 text-[12px]">
              {error}
            </div>
          )}

          {/* Percy Standard — always at the top */}
          {builtin.length > 0 && (
            <section className="mb-10">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-3">— Built in —</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {builtin.map((s) => (
                  <SetCard key={s.id} set={s} />
                ))}
              </div>
            </section>
          )}

          {/* Org sets */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted">
                — {activeOrg.name} —
              </div>
              <button
                onClick={() => setCreating(true)}
                className="text-[10px] uppercase tracking-wider px-3 py-1.5 border border-accent text-accent hover:bg-accent/10 transition-colors"
              >
                + New template set
              </button>
            </div>
            {!sets ? (
              <div className="text-[11px] text-muted italic px-2 py-6">Loading…</div>
            ) : orgSets.length === 0 ? (
              <div className="border border-edge bg-surface/30 p-8 text-center">
                <div className="text-[13px] text-paper mb-1">No team template sets yet.</div>
                <div className="text-[11px] text-muted max-w-md mx-auto">
                  Create one to bundle your brand palette, fonts, and slide patterns
                  for everyone in <strong>{activeOrg.name}</strong>. Upload reference
                  decks and Percy will mine them for templates automatically.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {orgSets.map((s) => (
                  <SetCard key={s.id} set={s} onChange={refresh} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Create modal */}
      {creating && activeOrg && (
        <CreateSetModal
          orgId={activeOrg.id}
          onClose={() => setCreating(false)}
          onCreated={(set) => {
            setCreating(false)
            toast.show(`Created "${set.name}"`, "success")
            navigate(`/template-sets/${set.id}`)
          }}
        />
      )}
    </div>
  )
}

// ── Set card ───────────────────────────────────────────────────────────────

function SetCard({ set, onChange }: { set: TemplateSet; onChange?: () => void }) {
  const toast = useToast()
  const handleSetDefault = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await setAsDefault(set.id, null)
      onChange?.()
      toast.show("Set as org default", "success")
    } catch (e) {
      toast.show(`Failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }
  return (
    <Link
      to={`/template-sets/${set.id}`}
      className="block border border-edge bg-surface/30 hover:border-accent hover:bg-surface/50 transition-colors p-5 group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-[14px] text-paper font-medium truncate">{set.name}</div>
            {set.is_builtin && (
              <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 border border-edge text-muted">
                BUILT-IN
              </span>
            )}
            {set.is_default && !set.is_builtin && (
              <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 border border-accent text-accent">
                DEFAULT
              </span>
            )}
          </div>
          {set.description && (
            <div className="text-[11px] text-muted line-clamp-2">{set.description}</div>
          )}
        </div>
      </div>

      {/* Palette preview */}
      {set.palette && set.palette.length > 0 && (
        <div className="flex items-center gap-1 mb-3">
          {set.palette.slice(0, 8).map((c, i) => (
            <div
              key={i}
              className="w-5 h-5 border border-edge rounded-sm"
              style={{ backgroundColor: c.hex }}
              title={`${c.name || c.role || ""} · ${c.hex}`}
            />
          ))}
          {set.palette.length > 8 && (
            <span className="text-[10px] text-muted ml-1">+{set.palette.length - 8}</span>
          )}
        </div>
      )}

      {/* Counts */}
      <div className="flex items-center gap-4 text-[10px] text-muted">
        <div>
          <span className="text-paper font-mono">{set.slide_items_count ?? 0}</span> slides
        </div>
        <div>
          <span className="text-paper font-mono">{set.element_items_count ?? 0}</span> elements
        </div>
        <div>
          <span className="text-paper font-mono">{set.fonts?.length ?? 0}</span> fonts
        </div>
        <div>
          <span className="text-paper font-mono">{set.refs_count ?? 0}</span> refs
        </div>
        <div className="flex-1" />
        {!set.is_builtin && !set.is_default && (
          <button
            onClick={handleSetDefault}
            className="text-[10px] uppercase tracking-wider text-muted hover:text-accent transition-colors"
          >
            Set default
          </button>
        )}
      </div>
    </Link>
  )
}

// ── Create modal ───────────────────────────────────────────────────────────

function CreateSetModal({
  orgId, onClose, onCreated,
}: {
  orgId: string
  onClose: () => void
  onCreated: (set: TemplateSet) => void
}) {
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [setAsDef, setSetAsDef] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) {
      setErr("Name is required.")
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const set = await createTemplateSet({
        org_id: orgId,
        name: name.trim(),
        description: desc.trim() || undefined,
        scope: "org",
        is_default: setAsDef,
      })
      onCreated(set)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-ink/80 flex items-center justify-center z-50 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-edge p-6 w-[420px] max-w-[90vw]"
      >
        <div className="text-[16px] text-paper font-medium mb-1">New template set</div>
        <div className="text-[11px] text-muted mb-4">
          You'll be able to upload reference decks and customize the brand once it's created.
        </div>

        <div className="space-y-3">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Name</div>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Brand v3"
              className="w-full bg-ink border border-edge px-3 py-2 text-[13px] text-paper focus:border-accent outline-none"
            />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Description</div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
              placeholder="Primary brand set for external decks"
              className="w-full bg-ink border border-edge px-3 py-2 text-[12px] text-paper focus:border-accent outline-none resize-none"
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-paper">
            <input
              type="checkbox"
              checked={setAsDef}
              onChange={(e) => setSetAsDef(e.target.checked)}
            />
            <span>Set as org default</span>
          </label>
        </div>

        {err && (
          <div className="mt-3 text-[11px] text-brick">{err}</div>
        )}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-[10px] uppercase tracking-wider px-3 py-1.5 text-muted hover:text-paper transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !name.trim()}
            className={`text-[10px] uppercase tracking-wider px-4 py-2 transition-colors ${
              busy || !name.trim()
                ? "border border-edge text-muted cursor-not-allowed"
                : "bg-accent text-ink hover:bg-accent/80"
            }`}
          >
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  )
}
