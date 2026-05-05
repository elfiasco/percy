import { useState, useEffect, useCallback, useRef } from "react"
import { Navigate, useNavigate, useSearchParams, Link } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import {
  listFolders, listProjects, createFolder, createProject, deleteFolder, deleteProject,
  updateProject, renameFolder,
  uploadProjectFile, openProject,
  type Folder, type Project, type Org,
} from "../lib/authApi"
import OrgSettings from "./OrgSettings"
import AccountSettings from "./AccountSettings"
import WelcomeModal, { shouldShowWelcome } from "./WelcomeModal"
import NewProjectModal from "../components/NewProjectModal"
import { useToast, useDialog } from "../components/Toaster"
import WorkspaceSearchTrigger from "../components/WorkspaceSearchTrigger"
import PageLoader from "../components/PageLoader"
import ThemeToggle from "../theme/ThemeToggle"
import Logo from "../components/Logo"

// ── Top bar ───────────────────────────────────────────────────────────────────

function TopBar({ activeOrg, onSelectOrg, onOpenSettings, onOpenAccount }: { activeOrg: Org; onSelectOrg: (id: string) => void; onOpenSettings: () => void; onOpenAccount: () => void }) {
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const navigate = useNavigate()
  if (!user) return null

  const orgs = user.orgs

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
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-slate-200 hover:bg-white/5"
          >
            <span className={`w-2 h-2 rounded-full ${activeOrg.kind === "team" ? "bg-accent" : "bg-slate-400"}`} />
            <span>{activeOrg.name}</span>
            <span className="text-muted/60 text-[9px] uppercase tracking-wider">{activeOrg.kind}</span>
            <span className="text-muted">▾</span>
          </button>
          {orgMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOrgMenuOpen(false)} />
              <div className="absolute z-50 top-full left-0 mt-1 w-56 bg-surface border border-edge rounded shadow-xl py-1">
                {orgs.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => { onSelectOrg(o.id); setOrgMenuOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 flex items-center gap-2 ${o.id === activeOrg.id ? "text-accent" : "text-slate-300"}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${o.kind === "team" ? "bg-accent" : "bg-slate-400"}`} />
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
        <button
          onClick={onOpenSettings}
          className="text-[10px] uppercase tracking-[0.14em] text-muted hover:text-paper px-2.5 py-1 border border-edge hover:bg-paper/5 transition-colors"
          title="Workspace settings (members, invites)"
        >Members</button>
        {user.is_admin && (
          <Link to="/dev" className="text-[10px] uppercase tracking-[0.14em] text-muted hover:text-paper px-2.5 py-1 border border-edge hover:bg-paper/5 transition-colors">
            /dev
          </Link>
        )}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-xs text-slate-200 hover:bg-white/15 overflow-hidden"
          >
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
              : <span>{user.display_name.slice(0, 1).toUpperCase()}</span>}
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-edge rounded shadow-xl py-1 z-50">
                <div className="px-3 py-1.5 text-[11px] text-muted">{user.email}</div>
                <div className="border-t border-edge my-1" />
                <button
                  onClick={() => { setMenuOpen(false); onOpenAccount() }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                >Account</button>
                <Link
                  to="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="block w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                >Settings</Link>
                <button
                  onClick={async () => { await logout(); navigate("/login") }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                >Sign out</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Folder tree ──────────────────────────────────────────────────────────────

interface FolderNode {
  folder: Folder | null  // null = root
  children: FolderNode[]
}

function buildTree(folders: Folder[]): FolderNode {
  const byId = new Map<string, FolderNode>()
  folders.forEach((f) => byId.set(f.id, { folder: f, children: [] }))
  const root: FolderNode = { folder: null, children: [] }
  folders.forEach((f) => {
    const node = byId.get(f.id)!
    if (f.parent_id && byId.has(f.parent_id)) {
      byId.get(f.parent_id)!.children.push(node)
    } else {
      root.children.push(node)
    }
  })
  return root
}

function FolderTreeNode({
  node, depth, selectedId, onSelect, onDelete, onRename,
}: {
  node: FolderNode; depth: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
}) {
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState("")
  const f = node.folder
  return (
    <div>
      <div
        onClick={() => f ? onSelect(f.id) : onSelect(null)}
        onDoubleClick={() => { if (f) { setEditing(true); setDraftName(f.name) } }}
        className={[
          "flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer group hover:bg-white/5",
          selectedId === (f?.id ?? null) ? "bg-accent/15 text-accent" : "text-slate-300",
        ].join(" ")}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {node.children.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
            className="text-muted/50 w-3 hover:text-slate-200"
          >{open ? "▾" : "▸"}</button>
        )}
        {!node.children.length && <span className="w-3" />}
        <span className="text-muted/70 text-[10px] tracking-widest">{f ? "▢" : "⬡"}</span>
        {f && editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => { const n = draftName.trim(); if (n && n !== f.name) onRename(f.id, n); setEditing(false) }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur()
              if (e.key === "Escape") setEditing(false)
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-xs bg-base/80 border border-accent/60 rounded px-1 py-0 text-slate-200 focus:outline-none"
          />
        ) : (
          <span className="flex-1 truncate">{f ? f.name : "Home"}</span>
        )}
        {f && !editing && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(f.id) }}
            className="opacity-0 group-hover:opacity-100 text-muted hover:text-bad text-[10px]"
            title="Delete folder"
          >×</button>
        )}
      </div>
      {open && node.children.map((c) => (
        <FolderTreeNode key={c.folder?.id ?? "root"} node={c} depth={depth + 1}
          selectedId={selectedId} onSelect={onSelect} onDelete={onDelete} onRename={onRename} />
      ))}
    </div>
  )
}

// ── Main Projects page (folder + grid; was previously /home) ────────────────

export default function ProjectsPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toast  = useToast()
  const dialog = useDialog()
  const [activeOrgId,    setActiveOrgId]    = useState<string | null>(null)
  const [folders,        setFolders]        = useState<Folder[]>([])
  const [projects,       setProjects]       = useState<Project[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [busy,           setBusy]           = useState<string | null>(null)
  const [opening,        setOpening]        = useState<string | null>(null)
  const [error,          setError]          = useState<string | null>(null)
  const [settingsOpen,   setSettingsOpen]   = useState(false)
  const [accountOpen,    setAccountOpen]    = useState(false)
  const [welcomeOpen,    setWelcomeOpen]    = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  // Allow other pages to open the new-project modal via URL: /projects?new=1
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setNewProjectOpen(true)
      // strip the param so a refresh doesn't reopen it
      const next = new URLSearchParams(searchParams)
      next.delete("new")
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Show welcome modal once per user (localStorage key)
  useEffect(() => {
    if (user && shouldShowWelcome(user)) setWelcomeOpen(true)
  }, [user])

  // Pick the user's first org by default
  useEffect(() => {
    if (user && user.orgs.length > 0 && !activeOrgId) {
      setActiveOrgId(user.orgs[0].id)
    }
  }, [user, activeOrgId])

  const refresh = useCallback(async () => {
    if (!activeOrgId) return
    try {
      const [fs, ps] = await Promise.all([
        listFolders(activeOrgId),
        listProjects(activeOrgId, { folderId: selectedFolder }),
      ])
      setFolders(fs.folders)
      setProjects(ps.projects)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeOrgId, selectedFolder])

  useEffect(() => { refresh() }, [refresh])

  if (loading)  return <PageLoader />
  if (!user)    return <Navigate to="/login" replace />
  if (user.orgs.length === 0) {
    return <div className="min-h-screen flex items-center justify-center bg-base text-muted text-sm">Setting up your workspace…</div>
  }

  const activeOrg = user.orgs.find((o) => o.id === activeOrgId) ?? user.orgs[0]
  const tree = buildTree(folders)

  const handleNewFolder = async () => {
    const name = await dialog.prompt({
      title:        "New folder",
      label:        "Folder name",
      placeholder:  "Q3 2026",
      confirmLabel: "Create folder",
    })
    if (!name) return
    setBusy("folder")
    try {
      await createFolder(activeOrg.id, name, selectedFolder)
      await refresh()
      toast.success(`Folder "${name}" created.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), "Couldn't create folder")
    } finally { setBusy(null) }
  }

  const handleNewProject = () => setNewProjectOpen(true)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const projectId = fileInputRef.current?.getAttribute("data-project-id")
    if (!file || !projectId) return
    setBusy("upload")
    try {
      await uploadProjectFile(projectId, file)
      await refresh()
      toast.success(`Uploaded "${file.name}".`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), "Upload failed")
    } finally {
      setBusy(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleDeleteFolder = async (id: string) => {
    const f = folders.find((x) => x.id === id)
    const ok = await dialog.confirm({
      title:        f ? `Delete folder "${f.name}"?` : "Delete folder?",
      body:         "Projects inside will move to home — they won't be deleted.",
      confirmLabel: "Delete folder",
      danger:       true,
    })
    if (!ok) return
    setBusy("delete-folder")
    try { await deleteFolder(id); await refresh(); toast.success("Folder deleted.") }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e), "Couldn't delete folder") }
    finally { setBusy(null) }
  }

  const handleRenameFolder = async (id: string, name: string) => {
    try { await renameFolder(id, name); await refresh() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e), "Rename failed") }
  }

  const handleRenameProject = async (p: Project, name: string) => {
    if (!name || name === p.name) return
    try { await updateProject(p.id, { name }); await refresh() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e), "Rename failed") }
  }

  const handleMoveProject = async (p: Project, targetFolderId: string | null) => {
    try {
      await updateProject(p.id, { folder_id: targetFolderId === null ? "" : targetFolderId })
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), "Couldn't move project")
    }
  }

  const handleDeleteProject = async (p: Project) => {
    const ok = await dialog.confirm({
      title:        `Delete "${p.name}"?`,
      body:         "This permanently removes the project and any uploaded source files. This cannot be undone.",
      confirmLabel: "Delete project",
      danger:       true,
    })
    if (!ok) return
    setBusy("delete-project")
    try { await deleteProject(p.id); await refresh(); toast.success("Project deleted.") }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e), "Delete failed") }
    finally { setBusy(null) }
  }

  const handleOpen = async (p: Project) => {
    if (!p.doc_source) {
      const ok = await dialog.confirm({
        title:        "No source file yet",
        body:         "This project doesn't have a source deck attached. Upload a .pptx now?",
        confirmLabel: "Upload",
      })
      if (ok) {
        fileInputRef.current?.setAttribute("data-project-id", p.id)
        fileInputRef.current?.click()
      }
      return
    }
    setOpening(p.id)
    try {
      await openProject(p.id)
      navigate(`/studio/${p.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), "Couldn't open project")
      setOpening(null)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-base text-slate-200">
      <TopBar
        activeOrg={activeOrg}
        onSelectOrg={(id) => { setActiveOrgId(id); setSelectedFolder(null) }}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
      />

      <div className="flex flex-1 min-h-0">
        {/* sidebar: folder tree */}
        <aside className="w-56 shrink-0 border-r border-edge bg-surface/60 flex flex-col">
          <div className="px-3 py-2 border-b border-edge flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-muted">Folders</span>
            <button
              onClick={handleNewFolder}
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge"
              title="New folder"
            >+ Folder</button>
          </div>
          <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
            <FolderTreeNode node={tree} depth={0}
              selectedId={selectedFolder}
              onSelect={setSelectedFolder}
              onDelete={handleDeleteFolder}
              onRename={handleRenameFolder} />
          </div>
        </aside>

        {/* main area: project grid */}
        <main className="flex-1 flex flex-col min-w-0">
          <div className="px-6 py-3 border-b border-edge flex items-center justify-between bg-surface/30">
            <div>
              <div className="text-sm font-medium text-slate-200">
                {selectedFolder
                  ? folders.find((f) => f.id === selectedFolder)?.name ?? "Folder"
                  : "Home"}
              </div>
              <div className="text-[11px] text-muted">{projects.length} project{projects.length === 1 ? "" : "s"}</div>
            </div>
            <button
              onClick={handleNewProject}
              disabled={!!busy}
              className="text-sm px-3 py-1.5 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-40"
            >+ New Project</button>
          </div>

          {error && (
            <div className="m-4 text-xs text-bad bg-bad/10 border border-bad/30 rounded px-3 py-2">{error}</div>
          )}

          <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
            {projects.length === 0 ? (
              <EmptyHomeState
                onNewProject={handleNewProject}
                onCreateNamed={async (name) => {
                  setBusy("project")
                  try {
                    const p = await createProject(activeOrg.id, name, selectedFolder)
                    await refresh()
                    toast.success(`Project "${name}" created.`)
                    const ok = await dialog.confirm({
                      title:        "Upload a deck now?",
                      body:         "You can drop in an existing .pptx so Percy can read and edit it.",
                      confirmLabel: "Upload",
                    })
                    if (ok) {
                      fileInputRef.current?.setAttribute("data-project-id", p.id)
                      fileInputRef.current?.click()
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e), "Couldn't create project")
                  } finally { setBusy(null) }
                }}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {projects.map((p) => (
                  <ProjectCard
                    key={p.id} project={p}
                    folders={folders}
                    onOpen={() => handleOpen(p)}
                    onDelete={() => handleDeleteProject(p)}
                    onRename={(name) => handleRenameProject(p, name)}
                    onMove={(folderId) => handleMoveProject(p, folderId)}
                    opening={opening === p.id}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* hidden file input used by both new-project and "upload to existing" */}
      <input ref={fileInputRef} type="file" accept=".pptx,.pdf" onChange={handleFileUpload} className="hidden" />

      {settingsOpen && <OrgSettings org={activeOrg} onClose={() => setSettingsOpen(false)} />}
      {accountOpen  && <AccountSettings onClose={() => setAccountOpen(false)} />}
      {welcomeOpen && user && <WelcomeModal user={user} onClose={() => setWelcomeOpen(false)} />}
      {newProjectOpen && (
        <NewProjectModal
          orgId={activeOrg.id}
          folderId={selectedFolder}
          onClose={() => setNewProjectOpen(false)}
          onCreated={async (p, mode) => {
            setNewProjectOpen(false)
            await refresh()
            if (mode === "document") {
              // Already uploaded by the modal — open the project right away.
              navigate(`/project/${p.id}`)
            } else if (mode === "prompt") {
              // Pending prompt is stashed; project detail page will offer to generate.
              navigate(`/project/${p.id}`)
            } else {
              navigate(`/project/${p.id}`)
            }
          }}
        />
      )}
    </div>
  )
}

function ProjectCard({ project, folders, onOpen, onDelete, onRename, onMove, opening }: {
  project: Project
  folders: Folder[]
  onOpen: () => void
  onDelete: () => void
  onRename: (name: string) => void
  onMove: (folderId: string | null) => void
  opening: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [draft,    setDraft]    = useState(project.name)
  const updated = new Date(project.updated_at * 1000)

  return (
    <div className="bg-surface border border-edge overflow-hidden hover:border-paper/30 transition-colors group relative">
      <button onClick={onOpen} className="w-full text-left">
        <div className="aspect-video bg-ink flex items-center justify-center text-muted/40 border-b border-edge">
          <span className="text-[28px] tracking-widest">{project.doc_source ? "▢" : "○"}</span>
        </div>
      </button>
      <div className="px-3 py-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { onRename(draft.trim()); setEditing(false) }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                if (e.key === "Escape") { setEditing(false); setDraft(project.name) }
                e.stopPropagation()
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-sm bg-base/80 border border-accent/60 rounded px-1.5 py-0.5 text-slate-200 focus:outline-none"
            />
          ) : (
            <div
              className="text-sm text-slate-200 truncate cursor-pointer"
              onClick={onOpen}
              onDoubleClick={() => { setEditing(true); setDraft(project.name) }}
            >{project.name}</div>
          )}
          <div className="text-[10px] text-muted/70">
            {opening ? "Opening…" : project.doc_source ? `Updated ${updated.toLocaleDateString()}` : "No file uploaded yet"}
          </div>
        </div>
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o) }}
            className="opacity-0 group-hover:opacity-100 text-muted hover:text-slate-200 text-sm w-6 h-6 rounded hover:bg-white/10"
            title="More"
          >⋯</button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-44 bg-surface border border-edge rounded shadow-xl py-1 z-50 text-xs">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setEditing(true); setDraft(project.name) }}
                  className="w-full text-left px-3 py-1.5 text-paper hover:bg-paper/5"
                >Rename</button>
                <Link
                  to={`/project/${project.id}`}
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }}
                  className="block w-full text-left px-3 py-1.5 text-paper hover:bg-paper/5"
                >Builds & schedule…</Link>
                <div className="border-t border-edge my-1" />
                <div className="px-3 py-1 text-[10px] text-muted uppercase tracking-widest">Move to</div>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onMove(null) }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-paper/5 ${project.folder_id === null ? "text-champagne" : "text-paper"}`}
                ><span className="text-muted/70 mr-1.5">⬡</span>Home {project.folder_id === null && "·"}</button>
                {folders.filter((f) => f.org_id === project.org_id).map((f) => (
                  <button
                    key={f.id}
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onMove(f.id) }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-paper/5 ${project.folder_id === f.id ? "text-champagne" : "text-paper"}`}
                  ><span className="text-muted/70 mr-1.5">▢</span>{f.name} {project.folder_id === f.id && "·"}</button>
                ))}
                <div className="border-t border-edge my-1" />
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
                  className="w-full text-left px-3 py-1.5 text-bad hover:bg-bad/10"
                >Delete</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


function EmptyHomeState({ onNewProject, onCreateNamed }: {
  onNewProject: () => void
  onCreateNamed: (name: string) => void
}) {
  const examples: Array<{ title: string; tagline: string; deckType: string }> = [
    { title: "Investor letter",     tagline: "Quarterly narrative bound to your fund data.",         deckType: "Q1 2026 Investor Letter" },
    { title: "Board deck",          tagline: "Recurring board update with live KPIs.",                deckType: "Board Update — March" },
    { title: "QBR",                 tagline: "Quarterly business review with refresh-on-demand.",     deckType: "Q4 QBR — Sales" },
  ]
  return (
    <div className="h-full flex flex-col">
      <div className="max-w-3xl mx-auto pt-12 pb-10 px-6 text-center">
        <div className="text-[10px] tracking-[0.22em] uppercase text-muted/70 mb-3">Onboard · Bind · Refresh</div>
        <h2 className="text-2xl font-semibold text-slate-100 leading-tight tracking-[-0.01em] mb-3">
          Onboard your existing decks. Percy extracts the structure.
        </h2>
        <p className="text-sm text-slate-400 leading-relaxed max-w-xl mx-auto">
          Every chart, table, and shape becomes a Bridge element you can bind to Python, refresh
          on demand, and export back to PowerPoint. The deck stops being the source of truth —
          it becomes a rendered result.
        </p>
        <button
          onClick={onNewProject}
          className="mt-6 px-4 py-2 rounded bg-white text-black hover:bg-white/90 font-medium text-sm"
        >+ New project</button>
      </div>

      <div className="max-w-3xl mx-auto px-6 w-full">
        <div className="text-[10px] tracking-[0.18em] uppercase text-muted/60 mb-2">Or start from a template</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {examples.map((ex) => (
            <button
              key={ex.title}
              onClick={() => onCreateNamed(ex.deckType)}
              className="text-left p-4 bg-surface border border-edge rounded-lg hover:border-white/30 transition-colors group"
            >
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted/70 mb-1.5 group-hover:text-slate-300">{ex.title}</div>
              <div className="text-sm text-slate-200 mb-1.5">{ex.deckType}</div>
              <div className="text-[11px] text-slate-500 leading-snug">{ex.tagline}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
