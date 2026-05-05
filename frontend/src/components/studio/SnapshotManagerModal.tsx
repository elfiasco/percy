import { useState, useEffect } from "react"
import { listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot } from "../../lib/studioApi"
import type { DocSnapshot } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onRestored: (slideCount: number) => void
}

function timeAgo(ts: number) {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function SnapshotManagerModal({ docId, onClose, onRestored }: Props) {
  const [snapshots, setSnapshots] = useState<DocSnapshot[]>([])
  const [loading, setLoading]     = useState(true)
  const [newName, setNewName]     = useState("")
  const [saving, setSaving]       = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [error, setError]         = useState("")
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = async () => {
    try {
      const r = await listSnapshots(docId)
      setSnapshots([...r.snapshots].reverse())
    } catch {
      setError("Failed to load snapshots")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    setError("")
    try {
      await createSnapshot(docId, name)
      setNewName("")
      await load()
    } catch {
      setError("Failed to create snapshot")
    } finally {
      setSaving(false)
    }
  }

  const handleRestore = async (snap: DocSnapshot) => {
    setRestoring(snap.id)
    setError("")
    try {
      const r = await restoreSnapshot(docId, snap.id)
      onRestored(r.slide_count)
      onClose()
    } catch {
      setError("Failed to restore snapshot")
    } finally {
      setRestoring(null)
      setConfirmId(null)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      await deleteSnapshot(docId, id)
      setSnapshots((prev) => prev.filter((s) => s.id !== id))
    } catch {
      setError("Failed to delete snapshot")
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Snapshot Manager</h2>
            <p className="text-white/40 text-xs mt-0.5">Save and restore named checkpoints of your document</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* save new snapshot */}
          <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 space-y-2">
            <p className="text-white/60 text-xs">Save current state as a named checkpoint</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
                placeholder="e.g. Before client review"
                className="flex-1 bg-white/5 border border-white/15 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-accent/50 placeholder:text-white/20"
              />
              <button
                onClick={handleSave}
                disabled={saving || !newName.trim()}
                className="px-3 py-1.5 rounded bg-accent/10 border border-accent/30 text-accent text-sm hover:bg-accent/20 disabled:opacity-40 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {/* list */}
          {loading ? (
            <div className="flex justify-center py-8 text-white/30 text-sm">Loading…</div>
          ) : snapshots.length === 0 ? (
            <div className="text-center py-8 text-white/30 text-sm">No snapshots yet — save one above</div>
          ) : (
            <div className="space-y-2">
              {snapshots.map((snap) => (
                <div key={snap.id} className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                  {confirmId === snap.id ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-white/60 text-xs">Restore "{snap.name}"? Current state will be saved to undo history.</p>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => setConfirmId(null)}
                          className="px-2.5 py-1 rounded text-white/50 text-xs hover:text-white/80 border border-white/10 hover:bg-white/5 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleRestore(snap)}
                          disabled={restoring === snap.id}
                          className="px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
                        >
                          {restoring === snap.id ? "Restoring…" : "Confirm"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-medium truncate">{snap.name}</div>
                        <div className="text-white/30 text-xs mt-0.5">
                          {snap.slide_count} slide{snap.slide_count !== 1 ? "s" : ""} · {timeAgo(snap.created_at)}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => setConfirmId(snap.id)}
                          className="px-2.5 py-1 rounded text-xs border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => handleDelete(snap.id)}
                          disabled={deleting === snap.id}
                          className="px-2 py-1 rounded text-xs border border-red-400/20 text-red-400/60 hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30 transition-colors"
                        >
                          {deleting === snap.id ? "…" : "✕"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-white/20 text-[10px] text-center">
            Up to 20 snapshots per session · Snapshots are not persisted after the server restarts
          </p>
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
