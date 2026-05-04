/**
 * CloudDashboard — right-side panel for Cloud mode.
 * Shows recent jobs across all projects and a document search box.
 */

import { useState, useEffect, useCallback } from "react"
import { CheckCircle, AlertCircle, Clock, Loader, Search, RefreshCw } from "lucide-react"
import * as cloudApi from "../lib/cloudApi"
import type { CloudJob, CloudDocument } from "../lib/cloudApi"

interface CloudDashboardProps {
  onLoadInStudio?: (bundleUri: string, name: string) => Promise<void>
}

export default function CloudDashboard({ onLoadInStudio }: CloudDashboardProps) {
  const [jobs, setJobs]             = useState<CloudJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<CloudDocument[]>([])
  const [searching, setSearching]   = useState(false)
  const [loadingBundle, setLoadingBundle] = useState<string | null>(null)

  const refreshJobs = useCallback(async () => {
    setJobsLoading(true)
    try { setJobs(await cloudApi.listRecentJobs(30)) }
    catch { /* swallow */ }
    finally { setJobsLoading(false) }
  }, [])

  useEffect(() => {
    refreshJobs()
    const t = setInterval(refreshJobs, 10_000)
    return () => clearInterval(t)
  }, [refreshJobs])

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try { setSearchResults(await cloudApi.searchDocuments(searchQuery)) }
      catch { setSearchResults([]) }
      finally { setSearching(false) }
    }, 350)
    return () => clearTimeout(timer)
  }, [searchQuery])

  async function handleLoadInStudio(doc: CloudDocument) {
    if (!doc.bundle_uri || !onLoadInStudio) return
    setLoadingBundle(doc.id)
    try { await onLoadInStudio(doc.bundle_uri, doc.name) }
    finally { setLoadingBundle(null) }
  }

  const runningJobs   = jobs.filter(j => j.status === "running")
  const queuedJobs    = jobs.filter(j => j.status === "queued")
  const recentDone    = jobs.filter(j => j.status === "completed" || j.status === "failed").slice(0, 15)

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4 text-sm">
      {/* Search */}
      <div>
        <p className="text-[10px] font-bold uppercase text-muted tracking-wide mb-1.5">Search Documents</p>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="w-full bg-black/30 border border-edge rounded pl-6 pr-2 py-1 text-xs text-slate-200 placeholder:text-muted focus:outline-none focus:border-accent/60"
            placeholder="Search by name…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searching && <Loader size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent animate-spin" />}
        </div>
        {searchResults.length > 0 && (
          <div className="mt-1 border border-edge rounded overflow-hidden">
            {searchResults.map(doc => (
              <div key={doc.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 border-b border-edge last:border-b-0">
                <DocStatusDot status={doc.status} />
                <span className="flex-1 text-xs text-slate-300 truncate" title={doc.name}>{doc.name}</span>
                {doc.status === "ready" && doc.bundle_uri && onLoadInStudio && (
                  <button
                    disabled={loadingBundle === doc.id}
                    onClick={() => handleLoadInStudio(doc)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 disabled:opacity-50"
                  >
                    {loadingBundle === doc.id ? "…" : "→ Studio"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {searchQuery.trim() && !searching && searchResults.length === 0 && (
          <p className="text-muted text-xs mt-1">No documents found.</p>
        )}
      </div>

      {/* Active jobs */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <p className="text-[10px] font-bold uppercase text-muted tracking-wide flex-1">Active Jobs</p>
          <button onClick={refreshJobs} className="btn-xs p-0.5" title="Refresh">
            <RefreshCw size={10} className={jobsLoading ? "animate-spin" : ""} />
          </button>
        </div>
        {runningJobs.length === 0 && queuedJobs.length === 0 ? (
          <p className="text-muted text-xs">No active jobs.</p>
        ) : (
          <div className="border border-edge rounded overflow-hidden">
            {[...runningJobs, ...queuedJobs].map(job => (
              <JobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>

      {/* Recent completed/failed */}
      {recentDone.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase text-muted tracking-wide mb-1.5">Recent Activity</p>
          <div className="border border-edge rounded overflow-hidden">
            {recentDone.map(job => (
              <JobRow key={job.id} job={job} />
            ))}
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="mt-auto pt-3 border-t border-edge flex gap-4 text-xs text-muted">
        <span><span className="text-yellow-400 font-semibold">{runningJobs.length}</span> running</span>
        <span><span className="text-slate-400 font-semibold">{queuedJobs.length}</span> queued</span>
        <span><span className="text-good font-semibold">{jobs.filter(j => j.status === "completed").length}</span> completed</span>
        <span><span className="text-bad font-semibold">{jobs.filter(j => j.status === "failed").length}</span> failed</span>
      </div>
    </div>
  )
}

function JobRow({ job }: { job: CloudJob }) {
  const age = job.created_at ? timeAgo(job.created_at) : ""
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-edge last:border-b-0 hover:bg-white/5">
      <JobStatusIcon status={job.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-300 truncate">{job.job_type}</span>
          <span className="text-[10px] text-muted ml-auto shrink-0">{age}</span>
        </div>
        <span className="text-[10px] text-muted font-mono truncate block">{job.id}</span>
      </div>
    </div>
  )
}

function JobStatusIcon({ status }: { status: CloudJob["status"] }) {
  if (status === "completed") return <CheckCircle size={12} className="text-good shrink-0" />
  if (status === "failed")    return <AlertCircle size={12} className="text-red-400 shrink-0" />
  if (status === "running")   return <Loader size={12} className="text-yellow-400 animate-spin shrink-0" />
  return <Clock size={12} className="text-muted shrink-0" />
}

function DocStatusDot({ status }: { status: CloudDocument["status"] }) {
  const color =
    status === "ready"     ? "bg-good" :
    status === "error"     ? "bg-red-400" :
    status === "processing" ? "bg-yellow-400" : "bg-muted"
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
