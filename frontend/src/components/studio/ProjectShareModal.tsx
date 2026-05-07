import { useState, useEffect } from "react"

interface Share {
  id: string
  grantee_id: string | null
  share_token: string | null
  role: string
  created_at: number
  expires_at: number | null
}

interface Props {
  projectId: string
  projectName: string
  open: boolean
  onClose: () => void
}

export default function ProjectShareModal({ projectId, projectName, open, onClose }: Props) {
  const [shares, setShares] = useState<Share[]>([])
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("viewer")
  const [creating, setCreating] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/projects/${projectId}/shares`, { credentials: "include" })
      if (r.ok) { const d = await r.json(); setShares(d.shares || []) }
    } finally { setLoading(false) }
  }

  useEffect(() => { if (open) load() }, [open, projectId])

  const createShare = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    try {
      const r = await fetch(`/api/projects/${projectId}/shares`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantee_email: email || null, role }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || "Failed") }
      const share = await r.json()
      if (share.share_token) {
        const link = `${window.location.origin}/share/${share.share_token}`
        setShareLink(link)
      }
      setEmail("")
      load()
    } catch (e: any) {
      alert(e.message || "Failed to create share")
    } finally { setCreating(false) }
  }

  const deleteShare = async (id: string) => {
    await fetch(`/api/projects/${projectId}/shares/${id}`, { method: "DELETE", credentials: "include" })
    load()
  }

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Share project</h2>
            <p className="text-sm text-gray-500 mt-0.5 truncate max-w-xs">{projectName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Invite by email or create link */}
          <form onSubmit={createShare} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invite by email or create a link</label>
              <div className="flex gap-2">
                <input value={email} onChange={e => setEmail(e.target.value)}
                  type="email"
                  placeholder="email@example.com (leave blank for a share link)"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <select value={role} onChange={e => setRole(e.target.value)}
                  className="px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
              </div>
            </div>
            <button type="submit" disabled={creating}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-lg text-sm transition-colors">
              {creating ? "Creating…" : email ? "Invite user" : "Create share link"}
            </button>
          </form>

          {/* New share link */}
          {shareLink && (
            <div className="p-3 bg-indigo-50 rounded-lg flex items-center gap-2">
              <input readOnly value={shareLink} className="flex-1 text-xs text-indigo-700 bg-transparent outline-none truncate" />
              <button onClick={() => copyLink(shareLink)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
                {linkCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          )}

          {/* Existing shares */}
          {loading && shares.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-2">Loading…</p>
          )}
          {shares.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Active shares ({shares.length})</h3>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {shares.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                    <div className="text-sm text-gray-700 truncate flex-1">
                      {s.grantee_id ? `User: ${s.grantee_id.slice(0, 8)}…` : `Link share`}
                      <span className="ml-2 text-xs text-gray-500 capitalize">{s.role}</span>
                      {s.share_token && (
                        <button onClick={() => copyLink(`${window.location.origin}/share/${s.share_token}`)}
                          className="ml-2 text-xs text-indigo-500 hover:text-indigo-700">copy link</button>
                      )}
                    </div>
                    <button onClick={() => deleteShare(s.id)} className="ml-2 text-gray-400 hover:text-red-500 shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
