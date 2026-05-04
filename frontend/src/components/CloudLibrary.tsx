/**
 * CloudLibrary — browse cloud orgs/projects/documents and trigger onboard jobs.
 */

import { useState, useEffect, useCallback } from "react"
import { Cloud, ChevronRight, Plus, RefreshCw, UploadCloud, CheckCircle, AlertCircle, Clock, Loader } from "lucide-react"
import * as cloudApi from "../lib/cloudApi"
import type { CloudOrg, CloudProject, CloudDocument, CloudJob } from "../lib/cloudApi"

type UploadState = "idle" | "uploading" | "queued" | "processing" | "done" | "error"

interface UploadStatus {
  filename: string
  state: UploadState
  jobId?: string
  error?: string
}

export default function CloudLibrary() {
  const [orgs, setOrgs]               = useState<CloudOrg[]>([])
  const [selectedOrg, setSelectedOrg] = useState<CloudOrg | null>(null)
  const [projects, setProjects]       = useState<CloudProject[]>([])
  const [selectedProject, setSelectedProject] = useState<CloudProject | null>(null)
  const [documents, setDocuments]     = useState<CloudDocument[]>([])
  const [jobs, setJobs]               = useState<CloudJob[]>([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [uploads, setUploads]         = useState<UploadStatus[]>([])

  // New org / project creation
  const [showNewOrg, setShowNewOrg]           = useState(false)
  const [newOrgName, setNewOrgName]           = useState("")
  const [showNewProject, setShowNewProject]   = useState(false)
  const [newProjectName, setNewProjectName]   = useState("")

  const loadOrgs = useCallback(async () => {
    setLoading(true); setError(null)
    try { setOrgs(await cloudApi.listOrgs()) }
    catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadOrgs() }, [loadOrgs])

  async function selectOrg(org: CloudOrg) {
    setSelectedOrg(org); setSelectedProject(null); setDocuments([]); setJobs([])
    setLoading(true)
    try { setProjects(await cloudApi.listProjects(org.id)) }
    catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  async function selectProject(project: CloudProject) {
    setSelectedProject(project)
    setLoading(true)
    try {
      const [docs, js] = await Promise.all([
        cloudApi.listDocuments(project.id),
        cloudApi.listJobs(project.id),
      ])
      setDocuments(docs)
      setJobs(js)
    }
    catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return
    const slug = newOrgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    try {
      const org = await cloudApi.createOrg(newOrgName.trim(), `${slug}-${Date.now()}`)
      setOrgs(prev => [...prev, org])
      setShowNewOrg(false); setNewOrgName("")
    } catch (e) { setError(String(e)) }
  }

  async function handleCreateProject() {
    if (!selectedOrg || !newProjectName.trim()) return
    try {
      const project = await cloudApi.createProject(selectedOrg.id, newProjectName.trim())
      setProjects(prev => [...prev, project])
      setShowNewProject(false); setNewProjectName("")
    } catch (e) { setError(String(e)) }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !selectedProject) return
    e.target.value = ""

    const status: UploadStatus = { filename: file.name, state: "uploading" }
    setUploads(prev => [status, ...prev])

    const update = (patch: Partial<UploadStatus>) =>
      setUploads(prev => prev.map(u => u.filename === file.name && u.state === status.state ? { ...u, ...patch } : u))

    try {
      // 1. prepare upload → presigned URL
      const prep = await cloudApi.prepareUpload(selectedProject.id, file.name, file.size)
      const docId = prep.document.id

      // 2. PUT to S3
      const put = await fetch(prep.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
      })
      if (!put.ok) throw new Error(`S3 upload failed: ${put.status}`)

      // 3. create onboard job
      const job = await cloudApi.createOnboardJob(docId)
      update({ state: "queued", jobId: job.id })

      // 4. poll for completion
      let attempts = 0
      const poll = async () => {
        attempts++
        const j = await cloudApi.getJob(job.id)
        if (j.status === "completed") {
          update({ state: "done" })
          await selectProject(selectedProject) // refresh doc list
          return
        }
        if (j.status === "failed") {
          update({ state: "error", error: j.error ?? "unknown error" })
          return
        }
        update({ state: j.status === "running" ? "processing" : "queued" })
        if (attempts < 60) setTimeout(poll, 5000)
        else update({ state: "error", error: "Timed out" })
      }
      setTimeout(poll, 3000)

    } catch (e) {
      setUploads(prev => prev.map(u => u.filename === file.name ? { ...u, state: "error", error: String(e) } : u))
    }
  }

  const jobForDoc = (docId: string) => jobs.find(j => j.document_id === docId)

  return (
    <div className="flex flex-col h-full overflow-hidden text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0">
        <Cloud size={14} className="text-accent-light" />
        <span className="font-semibold text-slate-300 text-xs">Cloud Library</span>
        <button onClick={loadOrgs} className="ml-auto btn-xs p-0.5" title="Refresh">
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mx-2 my-1 px-2 py-1 rounded bg-red-900/40 text-red-300 text-xs">{error}</div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Upload progress */}
        {uploads.length > 0 && (
          <Section title="Uploads">
            {uploads.slice(0, 5).map((u, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1">
                <UploadIcon state={u.state} />
                <span className="truncate text-xs text-slate-300 flex-1" title={u.filename}>{u.filename}</span>
                <span className="text-xs text-muted">{u.state}</span>
              </div>
            ))}
          </Section>
        )}

        {/* Orgs */}
        <Section
          title="Organisations"
          action={<button className="btn-xs p-0.5" onClick={() => setShowNewOrg(v => !v)}><Plus size={10}/></button>}
        >
          {showNewOrg && (
            <div className="flex gap-1 px-2 py-1">
              <input
                className="flex-1 text-xs bg-black/30 border border-edge rounded px-1 py-0.5 text-slate-200"
                placeholder="Org name"
                value={newOrgName}
                onChange={e => setNewOrgName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateOrg() }}
                autoFocus
              />
              <button className="btn-xs" onClick={handleCreateOrg}>OK</button>
            </div>
          )}
          {orgs.length === 0 && !loading && (
            <p className="text-muted text-xs px-3 py-1">No organisations yet.</p>
          )}
          {orgs.map(org => (
            <div
              key={org.id}
              className={`flex items-center gap-1 px-3 py-1.5 cursor-pointer hover:bg-white/5 ${selectedOrg?.id === org.id ? "text-accent-light font-semibold" : "text-slate-300"}`}
              onClick={() => selectOrg(org)}
            >
              <ChevronRight size={10} className={`transition-transform ${selectedOrg?.id === org.id ? "rotate-90" : ""}`} />
              <span className="truncate text-xs">{org.name}</span>
            </div>
          ))}
        </Section>

        {/* Projects */}
        {selectedOrg && (
          <Section
            title={`Projects in ${selectedOrg.name}`}
            action={<button className="btn-xs p-0.5" onClick={() => setShowNewProject(v => !v)}><Plus size={10}/></button>}
          >
            {showNewProject && (
              <div className="flex gap-1 px-2 py-1">
                <input
                  className="flex-1 text-xs bg-black/30 border border-edge rounded px-1 py-0.5 text-slate-200"
                  placeholder="Project name"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreateProject() }}
                  autoFocus
                />
                <button className="btn-xs" onClick={handleCreateProject}>OK</button>
              </div>
            )}
            {projects.length === 0 && !loading && (
              <p className="text-muted text-xs px-3 py-1">No projects yet.</p>
            )}
            {projects.map(p => (
              <div
                key={p.id}
                className={`flex items-center gap-1 px-3 py-1.5 cursor-pointer hover:bg-white/5 ${selectedProject?.id === p.id ? "text-accent-light font-semibold" : "text-slate-300"}`}
                onClick={() => selectProject(p)}
              >
                <ChevronRight size={10} className={`transition-transform ${selectedProject?.id === p.id ? "rotate-90" : ""}`} />
                <span className="truncate text-xs">{p.name}</span>
              </div>
            ))}
          </Section>
        )}

        {/* Documents */}
        {selectedProject && (
          <Section
            title={`Documents in ${selectedProject.name}`}
            action={
              <label className="btn-xs p-0.5 cursor-pointer" title="Upload PPTX/PDF">
                <UploadCloud size={10} />
                <input type="file" accept=".pptx,.pdf" className="hidden" onChange={handleUpload} />
              </label>
            }
          >
            {documents.length === 0 && !loading && (
              <p className="text-muted text-xs px-3 py-1">No documents yet. Click the upload icon.</p>
            )}
            {documents.map(doc => {
              const job = jobForDoc(doc.id)
              return (
                <div key={doc.id} className="px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <DocStatusIcon status={doc.status} />
                    <span className="truncate text-xs text-slate-300 flex-1" title={doc.name}>{doc.name}</span>
                  </div>
                  <div className="flex gap-2 mt-0.5 text-[10px] text-muted">
                    <span>{doc.status}</span>
                    {job && <span>· job: {job.status}</span>}
                    {doc.status === "ready" && (
                      <span className="text-good">· ready</span>
                    )}
                  </div>
                </div>
              )
            })}
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b border-edge last:border-b-0">
      <div className="flex items-center px-3 py-1.5 bg-black/20">
        <span className="text-[10px] font-bold uppercase text-muted tracking-wide flex-1">{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

function UploadIcon({ state }: { state: UploadState }) {
  if (state === "done") return <CheckCircle size={12} className="text-good shrink-0" />
  if (state === "error") return <AlertCircle size={12} className="text-red-400 shrink-0" />
  return <Loader size={12} className="text-accent-light animate-spin shrink-0" />
}

function DocStatusIcon({ status }: { status: CloudDocument["status"] }) {
  if (status === "ready") return <CheckCircle size={12} className="text-good shrink-0" />
  if (status === "error") return <AlertCircle size={12} className="text-red-400 shrink-0" />
  if (status === "processing") return <Loader size={12} className="text-yellow-400 animate-spin shrink-0" />
  return <Clock size={12} className="text-muted shrink-0" />
}
