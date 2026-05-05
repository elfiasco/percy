import { useState, useEffect, useCallback, useMemo } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { listProjects, listFolders, type Project, type Folder, type Org } from "../lib/authApi"
import Logo from "../components/Logo"
import ThemeToggle from "../theme/ThemeToggle"
import OrgSettings from "./OrgSettings"
import AccountSettings from "./AccountSettings"
import WelcomeModal, { shouldShowWelcome } from "./WelcomeModal"
import WorkspaceSearchTrigger from "../components/WorkspaceSearchTrigger"
import PageLoader from "../components/PageLoader"

/**
 * Dashboard — the new /home.
 *
 * The mission: orient the user toward "what's stale, what refreshed, what
 * changed" instead of "which file do I open?". This is what makes the product
 * feel like an operating layer, not a file manager.
 *
 * Sections:
 *   1. Greeting + workspace summary
 *   2. Recent decks (last 4-5 touched)
 *   3. Pipeline health placeholder (becomes real once builds land)
 *   4. Activity feed placeholder
 *   5. Quick search input (placeholder until corpus index lands)
 */

export default function Dashboard() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [recent, setRecent]           = useState<Project[]>([])
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [folders, setFolders]         = useState<Folder[]>([])
  const [error, setError]             = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accountOpen,  setAccountOpen]  = useState(false)
  const [welcomeOpen,  setWelcomeOpen]  = useState(false)

  // Pick the user's first org by default
  useEffect(() => {
    if (user && user.orgs.length > 0 && !activeOrgId) {
      setActiveOrgId(user.orgs[0].id)
    }
  }, [user, activeOrgId])

  // Show welcome on first visit
  useEffect(() => {
    if (user && shouldShowWelcome(user)) setWelcomeOpen(true)
  }, [user])

  const refresh = useCallback(async () => {
    if (!activeOrgId) return
    try {
      const [pr, fr] = await Promise.all([
        listProjects(activeOrgId),
        listFolders(activeOrgId),
      ])
      setAllProjects(pr.projects)
      setRecent(pr.projects.slice(0, 4))   // already sorted by updated_at DESC server-side
      setFolders(fr.folders)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeOrgId])

  useEffect(() => { refresh() }, [refresh])

  const stats = useMemo(() => {
    const total = allProjects.length
    const onboarded = allProjects.filter((p) => !!p.doc_source).length
    const empty = total - onboarded
    const lastWeek = allProjects.filter((p) => p.updated_at * 1000 > Date.now() - 7 * 86400_000).length
    return { total, onboarded, empty, lastWeek }
  }, [allProjects])

  if (loading) return <PageLoader />
  if (!user)   return <Navigate to="/login" replace />
  if (user.orgs.length === 0) {
    return <PageLoader caption="Setting up your workspace" />
  }

  const activeOrg = user.orgs.find((o) => o.id === activeOrgId) ?? user.orgs[0]
  const greetingTime = new Date().getHours()
  const greeting = greetingTime < 5 ? "It's late."
    : greetingTime < 12 ? "Good morning"
    : greetingTime < 18 ? "Good afternoon"
    : "Good evening"

  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper">
      <DashboardTopBar
        user={user}
        activeOrg={activeOrg}
        onSelectOrg={(id) => setActiveOrgId(id)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
      />

      <div className="flex-1 flex min-h-0">

        {/* ── left sidebar — folders + recent projects ───────────────── */}
        <DashboardSidebar
          folders={folders}
          allProjects={allProjects}
          activeOrgId={activeOrgId ?? ""}
          onNewProject={() => navigate("/projects?new=1")}
        />

        <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-12 space-y-12">

          {/* ── greeting + primary action ─────────────────────────────── */}
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-2">— {activeOrg.name} —</div>
              <h1 className="text-[32px] font-semibold tracking-[-0.01em] text-paper leading-[1.1]">
                {greeting}, <span className="text-muted">{user.display_name.split(" ")[0]}.</span>
              </h1>
              <p className="text-[13px] text-muted mt-2 max-w-xl leading-[1.7]">
                {stats.empty > 0
                  ? `${stats.empty} project${stats.empty === 1 ? "" : "s"} waiting on a source file. Onboard a deck to start binding.`
                  : stats.lastWeek > 0
                  ? `${stats.lastWeek} ${stats.lastWeek === 1 ? "project" : "projects"} touched in the last 7 days.`
                  : "Your workspace is quiet. Onboard a deck to begin."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/projects"
                className="text-[11px] tracking-[0.14em] uppercase text-muted hover:text-paper border border-edge px-3 py-2 hover:bg-paper/5 transition-colors">
                Browse all projects
              </Link>
              <button
                onClick={() => navigate(`/projects?new=1`)}
                className="text-[11px] tracking-[0.14em] uppercase bg-paper text-ink hover:bg-paper/90 px-4 py-2 transition-colors font-medium"
              >
                + New project
              </button>
            </div>
          </div>

          {error && <div className="text-[11px] text-bad bg-bad/10 border border-bad/30 px-3 py-2">{error}</div>}

          {/* ── workspace stats ─────────────────────────────────────────── */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-edge">
            <Stat label="Projects"          value={stats.total} />
            <Stat label="With source"        value={stats.onboarded} hint={stats.total > 0 ? `${Math.round(100 * stats.onboarded / Math.max(1, stats.total))}%` : undefined} />
            <Stat label="Edited last 7 days" value={stats.lastWeek} />
            <Stat label="Workspace role"     value={activeOrg.role ?? "—"} small />
          </section>

          {/* ── recent decks ────────────────────────────────────────────── */}
          <section>
            <SectionHeader
              eyebrow="Recently touched"
              title="Pick up where you left off"
              right={
                <Link to="/projects" className="text-[10px] tracking-[0.14em] uppercase text-muted hover:text-paper">
                  View all →
                </Link>
              }
            />
            {recent.length === 0 ? (
              <div className="border border-edge p-8 text-center">
                <Logo size={36} className="mb-3 mx-auto opacity-40" />
                <div className="text-[13px] text-muted">No projects yet.</div>
                <Link to="/projects?new=1" className="inline-block mt-4 text-[11px] tracking-[0.14em] uppercase bg-paper text-ink hover:bg-paper/90 px-4 py-2 transition-colors font-medium">
                  Create your first project
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {recent.map((p) => <RecentCard key={p.id} project={p} />)}
              </div>
            )}
          </section>

          {/* ── pipelines / builds (placeholder until task #75-76 land) ── */}
          <section>
            <SectionHeader
              eyebrow="Pipelines"
              title="Recurring decks and their refresh history"
            />
            <div className="border border-edge p-8 text-center">
              <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-2">— Coming next —</div>
              <div className="text-[13px] text-muted leading-[1.7] max-w-md mx-auto">
                When a project has a refresh schedule, every build appears here as a timeline:
                start time, status, output files (.percy / .pptx / .pdf), and a diff vs the prior build.
              </div>
            </div>
          </section>

          {/* ── activity feed placeholder ─────────────────────────────── */}
          <section>
            <SectionHeader
              eyebrow="Activity"
              title="Edits, refreshes, and approvals"
            />
            <div className="border border-edge p-8 text-center">
              <div className="text-[13px] text-muted leading-[1.7] max-w-md mx-auto">
                Activity from across your workspace will appear here once people start editing,
                refreshing, and approving decks.
              </div>
            </div>
          </section>

        </div>
        </div>
      </div>

      {settingsOpen && <OrgSettings org={activeOrg} onClose={() => setSettingsOpen(false)} />}
      {accountOpen  && <AccountSettings onClose={() => setAccountOpen(false)} />}
      {welcomeOpen && user && <WelcomeModal user={user} onClose={() => setWelcomeOpen(false)} />}
    </div>
  )
}

// ── pieces ────────────────────────────────────────────────────────────────────

function SectionHeader({ eyebrow, title, right }: { eyebrow: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mb-4">
      <div>
        <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1">— {eyebrow} —</div>
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-paper">{title}</h2>
      </div>
      {right}
    </div>
  )
}

function Stat({ label, value, hint, small }: { label: string; value: string | number; hint?: string; small?: boolean }) {
  return (
    <div className="px-5 py-4 border-r border-edge last:border-r-0">
      <div className="text-[9px] tracking-[0.18em] uppercase text-muted mb-1">{label}</div>
      <div className={`${small ? "text-[14px] text-paper capitalize" : "text-[24px] tabular-nums"} font-semibold tracking-[-0.01em] text-paper`}>
        {value}
        {hint && <span className="text-[11px] text-muted ml-2 tracking-normal">{hint}</span>}
      </div>
    </div>
  )
}

function RecentCard({ project }: { project: Project }) {
  const updated = new Date(project.updated_at * 1000)
  const daysAgo = Math.floor((Date.now() - project.updated_at * 1000) / 86400_000)
  const ago = daysAgo === 0 ? "today"
    : daysAgo === 1 ? "yesterday"
    : daysAgo < 7 ? `${daysAgo} days ago`
    : updated.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  return (
    <Link
      to={`/studio/${project.id}`}
      className="border border-edge hover:border-paper/30 transition-colors block group"
    >
      <div className="aspect-video bg-ink flex items-center justify-center text-muted/30 border-b border-edge group-hover:text-muted/60 transition-colors">
        <span className="text-[28px] tracking-widest">{project.doc_source ? "▢" : "○"}</span>
      </div>
      <div className="px-3 py-2.5">
        <div className="text-[13px] text-paper truncate mb-0.5">{project.name}</div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted flex items-center gap-2">
          <span>{ago}</span>
          {project.doc_id && <span className="text-champagne">· loaded</span>}
        </div>
      </div>
    </Link>
  )
}

function DashboardTopBar({
  user, activeOrg, onSelectOrg, onOpenSettings, onOpenAccount,
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>
  activeOrg: Org
  onSelectOrg: (id: string) => void
  onOpenSettings: () => void
  onOpenAccount: () => void
}) {
  const { logout } = useAuth()
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const [menuOpen, setMenuOpen]       = useState(false)
  const navigate = useNavigate()

  return (
    <div className="h-12 shrink-0 border-b border-edge bg-surface flex items-center justify-between px-5 select-none">
      <div className="flex items-center gap-4">
        <Link to="/home" className="flex items-center gap-2.5">
          <Logo size={18} />
          <span className="wordmark text-[12px]">Percy</span>
        </Link>
        <span className="text-edge">/</span>
        <div className="relative">
          <button
            onClick={() => setOrgMenuOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-paper hover:bg-paper/5"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${activeOrg.kind === "team" ? "bg-champagne" : "bg-paper/40"}`} />
            <span>{activeOrg.name}</span>
            <span className="text-muted/60 text-[9px] uppercase tracking-[0.16em]">{activeOrg.kind}</span>
            <span className="text-muted">▾</span>
          </button>
          {orgMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOrgMenuOpen(false)} />
              <div className="absolute z-50 top-full left-0 mt-1 w-56 bg-surface border border-edge shadow-xl py-1">
                {user.orgs.map((o) => (
                  <button key={o.id}
                    onClick={() => { onSelectOrg(o.id); setOrgMenuOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-paper/5 flex items-center gap-2 ${o.id === activeOrg.id ? "text-champagne" : "text-paper"}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${o.kind === "team" ? "bg-champagne" : "bg-paper/40"}`} />
                    <span className="flex-1 truncate">{o.name}</span>
                    <span className="text-muted/60 text-[9px] uppercase">{o.kind}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <WorkspaceSearchTrigger orgId={activeOrg.id} triggerButton />
        <ThemeToggle size="xs" />
        <button onClick={onOpenSettings}
          className="text-[10px] uppercase tracking-[0.14em] text-muted hover:text-paper px-2.5 py-1 border border-edge hover:bg-paper/5 transition-colors"
          title="Workspace settings">
          Members
        </button>
        {user.is_admin && (
          <Link to="/dev" className="text-[10px] uppercase tracking-[0.14em] text-muted hover:text-paper px-2.5 py-1 border border-edge hover:bg-paper/5 transition-colors">
            /dev
          </Link>
        )}
        <div className="relative">
          <button onClick={() => setMenuOpen((o) => !o)}
            className="w-8 h-8 rounded-full bg-paper/10 border border-edge flex items-center justify-center text-xs text-paper hover:bg-paper/15 overflow-hidden">
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
              : <span>{user.display_name.slice(0, 1).toUpperCase()}</span>}
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-edge shadow-xl py-1 z-50">
                <div className="px-3 py-1.5 text-[11px] text-muted">{user.email}</div>
                <div className="border-t border-edge my-1" />
                <button onClick={() => { setMenuOpen(false); onOpenAccount() }}
                  className="w-full text-left px-3 py-1.5 text-xs text-paper hover:bg-paper/5">Account</button>
                <Link to="/settings" onClick={() => setMenuOpen(false)}
                  className="block w-full text-left px-3 py-1.5 text-xs text-paper hover:bg-paper/5">Settings</Link>
                <button onClick={async () => { await logout(); navigate("/login") }}
                  className="w-full text-left px-3 py-1.5 text-xs text-paper hover:bg-paper/5">Sign out</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function DashboardSidebar({
  folders, allProjects, activeOrgId, onNewProject,
}: {
  folders: Folder[]
  allProjects: Project[]
  activeOrgId: string
  onNewProject: () => void
}) {
  // build a tree of folders (root = parent_id null)
  const rootFolders = folders.filter((f) => !f.parent_id)
  const recent5 = allProjects.slice(0, 5)
  return (
    <aside className="w-56 shrink-0 border-r border-edge bg-surface/40 hidden md:flex flex-col">
      <div className="px-4 pt-5 pb-2">
        <button
          onClick={onNewProject}
          className="w-full text-[10px] tracking-[0.16em] uppercase border border-edge text-muted hover:text-paper hover:bg-paper/5 transition-colors py-2"
        >+ New project</button>
      </div>
      <SidebarSection title="Recent">
        {recent5.length === 0 ? (
          <div className="text-[11px] text-muted/60 italic px-2">No projects yet.</div>
        ) : (
          recent5.map((p) => (
            <Link key={p.id} to={`/studio/${p.id}`}
              className="block px-2 py-1 text-[12px] text-paper hover:bg-paper/5 truncate transition-colors"
            >
              <span className="text-muted/60 mr-1.5">{p.doc_source ? "▢" : "○"}</span>{p.name}
            </Link>
          ))
        )}
      </SidebarSection>
      <SidebarSection title="Folders" linkText="All projects" linkTo="/projects">
        {rootFolders.length === 0 ? (
          <div className="text-[11px] text-muted/60 italic px-2">No folders.</div>
        ) : (
          rootFolders.map((f) => (
            <Link key={f.id} to={`/projects?folder=${f.id}`}
              className="block px-2 py-1 text-[12px] text-paper hover:bg-paper/5 truncate transition-colors"
            >
              <span className="text-muted/60 mr-1.5">▢</span>{f.name}
            </Link>
          ))
        )}
      </SidebarSection>
      <SidebarSection title="Workspace" linkText={null}>
        <Link to="/projects" className="block px-2 py-1 text-[12px] text-muted hover:text-paper hover:bg-paper/5 transition-colors">Projects</Link>
        <Link to={`/templates?org=${activeOrgId}`} className="block px-2 py-1 text-[12px] text-muted hover:text-paper hover:bg-paper/5 transition-colors">Templates</Link>
        <Link to="/settings" className="block px-2 py-1 text-[12px] text-muted hover:text-paper hover:bg-paper/5 transition-colors">Settings</Link>
      </SidebarSection>
      <div className="flex-1" />
    </aside>
  )
}

function SidebarSection({
  title, children, linkText, linkTo,
}: {
  title: string
  children: React.ReactNode
  linkText?: string | null
  linkTo?: string
}) {
  return (
    <div className="px-3 py-3 border-t border-edge first:border-t-0">
      <div className="flex items-baseline justify-between mb-1.5 px-1">
        <span className="text-[9px] tracking-[0.18em] uppercase text-muted">{title}</span>
        {linkText && linkTo && (
          <Link to={linkTo} className="text-[9px] tracking-[0.14em] uppercase text-muted hover:text-paper">
            {linkText} →
          </Link>
        )}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}
