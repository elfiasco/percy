import { useEffect, useState, useCallback } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { useTheme } from "../theme/ThemeContext"
import {
  listOrgMembers, listProjects, listFolders, listTemplates,
  type Template, type Project, type Folder,
} from "../lib/authApi"
import Logo from "../components/Logo"
import OrgSettings from "./OrgSettings"
import PageLoader from "../components/PageLoader"

export default function Settings() {
  const { user, loading } = useAuth()
  const { mode, setMode } = useTheme()
  const navigate = useNavigate()

  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [projects,    setProjects]    = useState<Project[]>([])
  const [folders,     setFolders]     = useState<Folder[]>([])
  const [templates,   setTemplates]   = useState<Template[]>([])
  const [orgModalOpen, setOrgModalOpen] = useState(false)

  useEffect(() => {
    if (user && user.orgs.length > 0 && !activeOrgId) setActiveOrgId(user.orgs[0].id)
  }, [user, activeOrgId])

  const refreshOrgInfo = useCallback(async () => {
    if (!activeOrgId) return
    try {
      const [m, p, f, t] = await Promise.all([
        listOrgMembers(activeOrgId).then((r) => r.members.length).catch(() => null),
        listProjects(activeOrgId).then((r) => r.projects).catch(() => []),
        listFolders(activeOrgId).then((r) => r.folders).catch(() => []),
        listTemplates(activeOrgId).then((r) => r.templates).catch(() => []),
      ])
      setMemberCount(m)
      setProjects(p)
      setFolders(f)
      setTemplates(t)
    } catch { /* ignore */ }
  }, [activeOrgId])

  useEffect(() => { refreshOrgInfo() }, [refreshOrgInfo])

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />

  const activeOrg = user.orgs.find((o) => o.id === activeOrgId) ?? user.orgs[0]
  const isTeam = activeOrg?.kind === "team"
  const isAdmin = activeOrg?.role === "owner" || activeOrg?.role === "admin"

  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper">
      <div className="h-14 shrink-0 border-b border-edge bg-surface flex items-center justify-between px-6 select-none">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)}
            className="text-[10px] uppercase tracking-[0.16em] text-muted hover:text-paper flex items-center gap-1.5 transition-colors">
            <span className="text-[12px] leading-none">←</span><span>Back</span>
          </button>
          <span className="text-edge">/</span>
          <Link to="/home" className="flex items-center gap-2.5">
            <Logo size={16} />
            <span className="wordmark text-[12px]">Percy</span>
          </Link>
          <span className="text-edge">/</span>
          <span className="text-[12px] text-paper">Settings</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-12 px-6">
        <div className="max-w-3xl mx-auto space-y-12">

          {/* ── Account ─────────────────────────────────────────────── */}
          <section>
            <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1">— Account —</div>
            <h2 className="text-[24px] font-semibold tracking-[-0.01em] text-paper mb-1">{user.display_name}</h2>
            <p className="text-[13px] text-muted leading-[1.7] mb-4">
              Signed in as <span className="text-paper">{user.email}</span>.
              {user.is_admin && <> · <span className="text-champagne">Platform admin</span></>}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-edge max-w-2xl">
              <Stat label="Workspaces"   value={user.orgs.length} />
              <Stat label="Personal orgs" value={user.orgs.filter((o) => o.kind === "personal").length} />
              <Stat label="Team orgs"     value={user.orgs.filter((o) => o.kind === "team").length} />
            </div>
          </section>

          {/* ── Appearance ─────────────────────────────────────────── */}
          <section>
            <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1">— Appearance —</div>
            <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-paper mb-1">Theme</h2>
            <p className="text-[12px] text-muted leading-[1.7] mb-5 max-w-md">
              Two settings, both monochrome. Your preference is saved per browser; it follows your OS preference until you choose.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ThemeCard active={mode === "dark"}  onClick={() => setMode("dark")}
                eyebrow="Dark"  title="Gatsby evening" preview="dark"
                body="Warm near-black panels, cream type, champagne accent. Built for studio sessions." />
              <ThemeCard active={mode === "light"} onClick={() => setMode("light")}
                eyebrow="Light" title="Gatsby letter" preview="light"
                body="Paper background, ink type, restrained champagne. Built for review and reading." />
            </div>
          </section>

          {/* ── Active workspace ─────────────────────────────────────── */}
          {activeOrg && (
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1">— Workspace —</div>
                  <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-paper">{activeOrg.name}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {user.orgs.length > 1 && (
                    <select
                      value={activeOrg.id}
                      onChange={(e) => setActiveOrgId(e.target.value)}
                      className="text-[11px] tracking-[0.14em] uppercase bg-ink border border-edge text-paper px-3 py-1.5 focus:outline-none"
                    >
                      {user.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  )}
                  {isAdmin && (
                    <button onClick={() => setOrgModalOpen(true)}
                      className="text-[10px] tracking-[0.14em] uppercase border border-edge text-muted hover:text-paper hover:bg-paper/5 px-3 py-1.5 transition-colors">
                      Manage members
                    </button>
                  )}
                </div>
              </div>

              <div className={`grid gap-0 border border-edge ${isTeam ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2"}`}>
                <Stat label="Type"        value={activeOrg.kind} small />
                <Stat label="Your role"    value={activeOrg.role ?? "—"} small />
                {isTeam && <Stat label="Members"     value={memberCount ?? "—"} />}
                {isTeam && <Stat label="Domain"      value={activeOrg.domain ?? "—"} small />}
                <Stat label="Projects"     value={projects.length} />
                <Stat label="Folders"      value={folders.length} />
                <Stat label="Templates"    value={templates.length} />
                <Stat label="Decks loaded" value={projects.filter((p) => !!p.doc_source).length} />
              </div>

              {isTeam && (
                <p className="text-[11px] text-muted leading-[1.7] mt-3">
                  Anyone with an <span className="text-paper">@{activeOrg.domain}</span> email auto-joins this workspace.
                  {isAdmin && <> Use Manage members to invite outside collaborators.</>}
                </p>
              )}

              {/* Templates link */}
              <div className="mt-6 border border-edge p-4">
                <div className="flex items-baseline justify-between mb-1">
                  <div className="text-[10px] tracking-[0.18em] uppercase text-muted">Brand templates</div>
                  <Link to={`/templates?org=${activeOrg.id}`}
                    className="text-[10px] tracking-[0.14em] uppercase text-muted hover:text-paper">
                    Open templates →
                  </Link>
                </div>
                <div className="text-[12px] text-paper leading-[1.7]">
                  {templates.length === 0
                    ? <>No templates yet. <Link to={`/templates?org=${activeOrg.id}`} className="underline">Create one</Link> and attach decks so Percy can extract their brand.</>
                    : <>{templates.length} template{templates.length === 1 ? "" : "s"} — Percy uses these as the team's visual memory when generating or restyling decks.</>
                  }
                </div>
              </div>
            </section>
          )}

          {/* ── About ─────────────────────────────────────────────────── */}
          <section className="pt-6 border-t border-edge">
            <div className="flex items-center gap-3 mb-3">
              <Logo size={20} tone="muted" className="opacity-60" />
              <span className="text-[10px] tracking-[0.22em] uppercase text-muted">— About —</span>
            </div>
            <p className="text-[12px] text-muted leading-[1.7] max-w-xl">
              Percy is the missing operating layer between data, AI, and business storytelling.
              The deck is not the source of truth — it should be a rendered result.
            </p>
          </section>

        </div>
      </div>

      {orgModalOpen && activeOrg && <OrgSettings org={activeOrg} onClose={() => { setOrgModalOpen(false); refreshOrgInfo() }} />}
    </div>
  )
}

// ── pieces ────────────────────────────────────────────────────────────────────

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="px-4 py-3 border-r border-b border-edge last:border-r-0 [&:nth-child(odd)]:md:border-r [&:nth-last-child(-n+2)]:border-b-0">
      <div className="text-[9px] tracking-[0.18em] uppercase text-muted mb-1">{label}</div>
      <div className={`${small ? "text-[13px] capitalize" : "text-[20px] tabular-nums"} font-semibold tracking-[-0.01em] text-paper`}>
        {value}
      </div>
    </div>
  )
}

function ThemeCard({
  active, onClick, eyebrow, title, body, preview,
}: {
  active: boolean
  onClick: () => void
  eyebrow: string
  title: string
  body: string
  preview: "dark" | "light"
}) {
  const palette = preview === "dark"
    ? { bg: "#0a0a0a", surface: "#111111", text: "#f5f5f0", muted: "#8a8a85", accent: "#e8c97a" }
    : { bg: "#f8f6ef", surface: "#ffffff", text: "#1a1a18", muted: "#6a6a64", accent: "#b08838" }

  return (
    <button onClick={onClick}
      className={`text-left p-4 border transition-colors ${
        active ? "border-paper bg-paper/5" : "border-edge hover:border-paper/30"
      }`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] tracking-[0.18em] uppercase text-muted">{eyebrow}</span>
        {active && <span className="text-[10px] tracking-[0.14em] uppercase text-champagne">Active</span>}
      </div>
      <div className="text-[16px] font-semibold tracking-[-0.01em] text-paper mb-2">{title}</div>
      <div className="text-[12px] text-muted leading-relaxed mb-3">{body}</div>
      <div style={{ background: palette.bg, color: palette.text }} className="border border-edge">
        <div style={{ background: palette.surface, borderBottom: `1px solid ${palette.muted}33` }}
             className="h-6 px-2 flex items-center text-[9px] tracking-[0.18em] uppercase">
          <span style={{ color: palette.text }}>Percy</span>
          <span style={{ color: palette.muted }} className="mx-1.5">/</span>
          <span style={{ color: palette.muted }}>Slide 3</span>
        </div>
        <div className="px-2 py-3 flex items-center gap-2">
          <span style={{ color: palette.text }} className="text-[10px] font-mono">3</span>
          <span style={{ background: palette.surface }} className="flex-1 h-6 border" />
          <span style={{ background: palette.accent, color: palette.bg }}
                className="text-[8px] uppercase tracking-[0.14em] px-1 py-0.5">PY</span>
        </div>
      </div>
    </button>
  )
}
