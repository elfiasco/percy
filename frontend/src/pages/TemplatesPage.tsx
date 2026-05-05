import { useState, useEffect, useCallback } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  attachProjectToTemplate, detachProjectFromTemplate, extractTemplateBrand,
  listProjects,
  type Template, type Project,
} from "../lib/authApi"
import Logo from "../components/Logo"
import ThemeToggle from "../theme/ThemeToggle"
import { useToast, useDialog } from "../components/Toaster"
import WorkspaceSearchTrigger from "../components/WorkspaceSearchTrigger"
import PageLoader from "../components/PageLoader"

/**
 * Templates — a per-org library of brand/style profiles.
 *
 * A template is created blank, then "attached" to one or more existing
 * projects. Hitting "Run extraction" walks every attached project's Bridge
 * model and pulls out colors, fonts, chart styles, table conventions — the
 * raw material for the agent to use when creating or restyling decks.
 *
 * URL: /templates?org=<id>&t=<template_id>?
 */

export default function TemplatesPage() {
  const { user, loading } = useAuth()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  const orgIdFromUrl = params.get("org")
  const selectedId   = params.get("t")

  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [error, setError]         = useState<string | null>(null)

  const activeOrg = user?.orgs.find((o) => o.id === orgIdFromUrl) ?? user?.orgs[0]

  const refresh = useCallback(async () => {
    if (!activeOrg) return
    try {
      const r = await listTemplates(activeOrg.id)
      setTemplates(r.templates)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeOrg])

  useEffect(() => { refresh() }, [refresh])

  // Sync URL when active org changes
  useEffect(() => {
    if (activeOrg && orgIdFromUrl !== activeOrg.id) {
      setParams({ org: activeOrg.id, ...(selectedId ? { t: selectedId } : {}) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id])

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (!activeOrg) return <div className="min-h-screen flex items-center justify-center bg-ink text-muted text-sm">No workspace.</div>

  const selected = templates?.find((t) => t.id === selectedId) ?? null

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
          <span className="text-[12px] text-paper">Templates</span>
          <span className="text-muted">·</span>
          <span className="text-[12px] text-muted">{activeOrg.name}</span>
        </div>
        <WorkspaceSearchTrigger orgId={activeOrg.id} triggerButton />
        <ThemeToggle size="xs" />
      </div>

      <div className="flex-1 flex min-h-0">

        {/* ── list ─────────────────────────────────────────────────── */}
        <aside className="w-72 shrink-0 border-r border-edge bg-surface/40 flex flex-col">
          <div className="px-4 pt-5 pb-3 border-b border-edge">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[10px] tracking-[0.18em] uppercase text-muted">— Templates —</span>
              <span className="text-[10px] text-muted">{templates?.length ?? "·"}</span>
            </div>
            <NewTemplateForm
              org={activeOrg}
              onCreated={(t) => {
                refresh()
                setParams({ org: activeOrg.id, t: t.id })
              }}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {!templates ? (
              <div className="px-2 py-2 text-[11px] text-muted italic">Loading…</div>
            ) : templates.length === 0 ? (
              <div className="px-2 py-3 text-[11px] text-muted leading-relaxed">
                No templates yet. Create one and attach a deck so Percy can
                extract its brand patterns.
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setParams({ org: activeOrg.id, t: t.id })}
                  className={`w-full text-left px-2 py-1.5 transition-colors ${
                    t.id === selectedId
                      ? "bg-paper/10 text-paper"
                      : "text-paper hover:bg-paper/5"
                  }`}
                >
                  <div className="text-[12px] truncate">{t.name}</div>
                  <div className="text-[9px] tracking-[0.14em] uppercase text-muted mt-0.5">
                    {t.scope} · {t.source_project_ids.length} source{t.source_project_ids.length === 1 ? "" : "s"}
                    {t.last_extracted_at && <> · extracted</>}
                  </div>
                  {/* Brand swatches at-a-glance — shows the extracted colors so the
                      list reads like a palette catalog rather than a list of names. */}
                  {t.brand?.colors && t.brand.colors.length > 0 && (
                    <div className="flex gap-0.5 mt-1.5">
                      {t.brand.colors.slice(0, 6).map((c) => (
                        <span
                          key={c.hex}
                          className="w-3 h-3 border border-edge"
                          style={{ background: c.hex }}
                          title={c.hex}
                        />
                      ))}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </aside>

        {/* ── detail / brand summary ──────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-6 text-[11px] text-bad bg-bad/10 border border-bad/30 px-3 py-2">{error}</div>
          )}
          {selected
            ? <TemplateDetail
                key={selected.id}
                template={selected}
                org={activeOrg}
                onChange={refresh}
                onDeleted={() => { setParams({ org: activeOrg.id }); refresh() }}
              />
            : <EmptyDetail />}
        </main>
      </div>
    </div>
  )
}

// ── New template form ────────────────────────────────────────────────────────

function NewTemplateForm({ org, onCreated }: {
  org: NonNullable<ReturnType<typeof useAuth>["user"]>["orgs"][number]
  onCreated: (t: Template) => void
}) {
  const [name, setName] = useState("")
  const [scope, setScope] = useState<"user" | "team">(org.kind === "team" ? "team" : "user")
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const t = await createTemplate(org.id, { name: name.trim(), scope })
      setName("")
      onCreated(t)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") create() }}
        placeholder="New template name…"
        disabled={busy}
        className="w-full text-[12px] bg-ink border border-edge px-2 py-1.5 text-paper focus:outline-none focus:border-paper/40"
      />
      {org.kind === "team" && (
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "user" | "team")}
          className="w-full text-[10px] tracking-[0.14em] uppercase bg-ink border border-edge px-2 py-1 text-paper focus:outline-none"
        >
          <option value="user">Personal</option>
          <option value="team">Team — {org.name}</option>
        </select>
      )}
      <button
        onClick={create}
        disabled={busy || !name.trim()}
        className="w-full text-[10px] tracking-[0.16em] uppercase border border-edge text-muted hover:text-paper hover:bg-paper/5 transition-colors py-1.5 disabled:opacity-40"
      >
        {busy ? "Creating…" : "+ Create template"}
      </button>
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyDetail() {
  return (
    <div className="h-full flex items-center justify-center px-12">
      <div className="max-w-md text-center">
        <Logo size={48} tone="muted" className="opacity-50 mx-auto mb-4" />
        <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-2">— Templates —</div>
        <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-paper mb-3">
          Brand profiles your decks can build from.
        </h2>
        <p className="text-[13px] text-muted leading-[1.7]">
          Attach existing decks to a template, run extraction, and Percy collects
          the colors, fonts, chart conventions, and table styles your team uses.
          The agent will draw from this when creating or restyling new decks.
        </p>
      </div>
    </div>
  )
}

// ── Template detail ──────────────────────────────────────────────────────────

function TemplateDetail({
  template, org, onChange, onDeleted,
}: {
  template: Template
  org: NonNullable<ReturnType<typeof useAuth>["user"]>["orgs"][number]
  onChange: () => void
  onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(template.name)
  const [draftDesc, setDraftDesc] = useState(template.description ?? "")
  const [orgProjects, setOrgProjects] = useState<Project[]>([])
  const [extracting, setExtracting] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast  = useToast()
  const dialog = useDialog()

  useEffect(() => {
    listProjects(org.id).then((r) => setOrgProjects(r.projects)).catch(() => {})
  }, [org.id])

  useEffect(() => {
    setDraftName(template.name)
    setDraftDesc(template.description ?? "")
  }, [template.id])

  const save = async () => {
    setBusy(true)
    try {
      await updateTemplate(template.id, { name: draftName.trim() || template.name, description: draftDesc })
      setEditing(false)
      onChange()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const onAttach = async (pid: string) => {
    setBusy(true)
    try { await attachProjectToTemplate(template.id, pid); onChange() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally  { setBusy(false) }
  }
  const onDetach = async (pid: string) => {
    setBusy(true)
    try { await detachProjectFromTemplate(template.id, pid); onChange() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally  { setBusy(false) }
  }

  const runExtract = async () => {
    setExtracting(true)
    try {
      await extractTemplateBrand(template.id)
      onChange()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setExtracting(false)
    }
  }

  const onDelete = async () => {
    const ok = await dialog.confirm({
      title:        `Delete template "${template.name}"?`,
      body:         "Source projects stay attached but lose this brand profile.",
      confirmLabel: "Delete template",
      danger:       true,
    })
    if (!ok) return
    try {
      await deleteTemplate(template.id)
      onDeleted()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const attached = orgProjects.filter((p) => template.source_project_ids.includes(p.id))
  const notAttached = orgProjects.filter((p) => !template.source_project_ids.includes(p.id) && !!p.doc_source)
  const brand = template.brand ?? {}
  const last = template.last_extracted_at
    ? new Date(template.last_extracted_at * 1000)
    : null

  return (
    <div className="max-w-3xl mx-auto px-8 py-10 space-y-10">

      {/* ── header ──────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between gap-4 mb-4">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-2">
              — {template.scope === "user" ? "Personal" : "Team"} template —
            </div>
            {editing ? (
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full text-[28px] font-semibold tracking-[-0.01em] text-paper bg-transparent border-b border-edge focus:outline-none focus:border-paper/40 pb-1"
              />
            ) : (
              <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-paper">{template.name}</h1>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {editing ? (
              <>
                <button onClick={() => setEditing(false)}
                  className="text-[10px] tracking-[0.14em] uppercase text-muted hover:text-paper px-3 py-1.5 border border-edge hover:bg-paper/5 transition-colors">Cancel</button>
                <button onClick={save} disabled={busy}
                  className="text-[10px] tracking-[0.14em] uppercase bg-paper text-ink hover:bg-paper/90 px-3 py-1.5 transition-colors font-medium">Save</button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)}
                  className="text-[10px] tracking-[0.14em] uppercase text-muted hover:text-paper px-3 py-1.5 border border-edge hover:bg-paper/5 transition-colors">Edit</button>
                <button onClick={onDelete}
                  className="text-[10px] tracking-[0.14em] uppercase text-muted hover:text-bad px-3 py-1.5 border border-edge hover:bg-bad/5 transition-colors">Delete</button>
              </>
            )}
          </div>
        </div>
        {editing ? (
          <textarea
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            placeholder="What is this template for? (optional)"
            rows={2}
            className="w-full text-[13px] text-paper bg-ink border border-edge px-3 py-2 focus:outline-none focus:border-paper/40"
          />
        ) : (
          <p className="text-[13px] text-muted leading-[1.7]">
            {template.description || <span className="italic">No description.</span>}
          </p>
        )}
      </section>

      {/* ── source projects ─────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1">— Source projects —</div>
            <div className="text-[14px] text-paper">{attached.length} attached</div>
          </div>
          <button
            onClick={runExtract}
            disabled={extracting || attached.length === 0}
            className="text-[11px] tracking-[0.14em] uppercase bg-paper text-ink hover:bg-paper/90 px-4 py-2 transition-colors font-medium disabled:opacity-40 flex items-center gap-2"
          >
            {extracting && <span className="inline-block w-2 h-2 border border-ink border-t-transparent rounded-full animate-spin" />}
            {extracting ? "Extracting…" : "Run extraction"}
          </button>
        </div>
        <div className="space-y-1.5">
          {attached.length === 0 && (
            <div className="text-[11px] text-muted italic">
              Attach a deck to extract its brand. Only projects with a source file can be attached.
            </div>
          )}
          {attached.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border border-edge p-2">
              {p.doc_id ? (
                <img
                  src={`/api/docs/${p.doc_id}/slides/1/bridge.png`}
                  alt=""
                  className="w-16 h-9 object-cover bg-base border border-edge shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden" }}
                />
              ) : (
                <div className="w-16 h-9 bg-base border border-edge shrink-0 flex items-center justify-center text-[9px] text-muted">
                  no source
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-paper truncate">{p.name}</div>
                <div className="text-[10px] tracking-[0.14em] uppercase text-muted">
                  {p.doc_source ? "Onboarded" : "No source yet"}
                </div>
              </div>
              <button onClick={() => onDetach(p.id)} disabled={busy}
                className="text-[10px] tracking-[0.14em] uppercase text-muted hover:text-bad px-2 py-1 shrink-0">
                Detach
              </button>
            </div>
          ))}
        </div>
        {notAttached.length > 0 && (
          <details className="mt-4">
            <summary className="text-[10px] tracking-[0.18em] uppercase text-muted cursor-pointer hover:text-paper">
              + Attach a project ({notAttached.length} available)
            </summary>
            <div className="mt-2 space-y-1 max-h-60 overflow-y-auto border border-edge">
              {notAttached.map((p) => (
                <button key={p.id} onClick={() => onAttach(p.id)} disabled={busy}
                  className="w-full text-left flex items-center justify-between px-3 py-2 hover:bg-paper/5 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted">▢</span>
                    <span className="text-[12px] text-paper truncate">{p.name}</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted">+ attach</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* ── brand profile ───────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1">— Brand profile —</div>
            <div className="text-[14px] text-paper">
              {last
                ? <>Extracted {last.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</>
                : <span className="italic text-muted">Not yet extracted.</span>}
            </div>
          </div>
        </div>

        {last ? (
          <div className="space-y-6">
            {/* Colors */}
            {brand.colors && brand.colors.length > 0 && (
              <div>
                <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-2">Colors</div>
                <div className="flex flex-wrap gap-2">
                  {brand.colors.map((c) => (
                    <div key={c.hex} className="flex items-center gap-2 border border-edge px-2 py-1.5">
                      <span className="w-5 h-5 border border-edge" style={{ background: c.hex }} />
                      <span className="text-[10px] font-mono text-paper">{c.hex}</span>
                      <span className="text-[10px] text-muted">×{c.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fonts */}
            {brand.fonts && brand.fonts.length > 0 && (
              <div>
                <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-2">Fonts</div>
                <ul className="space-y-1">
                  {brand.fonts.map((f) => (
                    <li key={f.name} className="flex items-center justify-between border border-edge px-3 py-1.5">
                      <span className="text-[13px] text-paper" style={{ fontFamily: f.name }}>{f.name}</span>
                      <span className="text-[10px] text-muted">×{f.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Chart types */}
            {brand.chart_types && brand.chart_types.length > 0 && (
              <div>
                <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-2">Chart conventions</div>
                <div className="flex flex-wrap gap-1.5">
                  {brand.chart_types.map((ct) => (
                    <span key={ct.type} className="text-[10px] tracking-[0.14em] uppercase border border-edge px-2 py-1 text-paper">
                      {ct.type.replace(/_/g, " ")} · ×{ct.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Tables */}
            {brand.table_summary && brand.table_summary.count > 0 && (
              <div>
                <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-2">Tables</div>
                <div className="text-[12px] text-paper">
                  {brand.table_summary.count} tables ·
                  {" "}{brand.table_summary.banded_rows_pct}% banded ·
                  {" "}{brand.table_summary.first_row_header_pct}% header row
                </div>
              </div>
            )}

            {/* Typography */}
            {brand.typography && (
              <div>
                <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-2">Typography</div>
                <div className="text-[12px] text-paper">
                  Avg title {brand.typography.avg_title_size ?? "—"}pt ·
                  {" "}avg body {brand.typography.avg_body_size ?? "—"}pt
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="border border-edge p-6 text-[12px] text-muted leading-[1.7] text-center">
            Attach one or more decks above, then click <span className="text-paper">Run extraction</span> to
            collect the colors, fonts, chart styles, and table conventions used across them.
          </div>
        )}
      </section>

    </div>
  )
}
