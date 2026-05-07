import { useState, useEffect } from "react"

interface AuditEvent {
  id: string
  org_id: string | null
  user_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  details: string
  ip_addr: string | null
  created_at: number
}

interface Props {
  orgId?: string
  isAdmin?: boolean
}

export default function AuditLogPage({ orgId, isAdmin }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const limit = 50

  const load = async (off = 0) => {
    setLoading(true)
    try {
      const url = isAdmin
        ? `/api/admin/audit-events?limit=${limit}&offset=${off}${orgId ? `&org_id=${orgId}` : ""}`
        : `/api/admin/orgs/${orgId}/audit-events?limit=${limit}&offset=${off}`
      const r = await fetch(url, { credentials: "include" })
      if (r.ok) {
        const d = await r.json()
        setEvents(d.events || [])
        setOffset(off)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(0) }, [orgId])

  const fmt = (ts: number) => new Date(ts * 1000).toLocaleString()

  const actionColor = (action: string) => {
    if (action.includes("delete") || action.includes("remove")) return "text-red-600 bg-red-50"
    if (action.includes("create") || action.includes("upload")) return "text-green-700 bg-green-50"
    if (action.includes("update") || action.includes("patch")) return "text-blue-700 bg-blue-50"
    return "text-gray-700 bg-gray-100"
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">All actions taken in your organization</p>
        </div>
        <button onClick={() => load(0)} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">Refresh</button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No audit events yet</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Time</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Resource</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmt(e.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${actionColor(e.action)}`}>{e.action}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {e.resource_type && <span className="text-gray-400 mr-1">{e.resource_type}</span>}
                    {e.resource_id && <span className="font-mono text-xs">{e.resource_id.slice(0, 12)}…</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">
                    {e.user_id ? e.user_id.slice(0, 12) + "…" : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{e.ip_addr || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <button onClick={() => offset > 0 && load(offset - limit)} disabled={offset === 0}
              className="text-sm text-indigo-600 hover:text-indigo-700 disabled:opacity-40 font-medium">← Previous</button>
            <span className="text-xs text-gray-500">Showing {offset + 1}–{offset + events.length}</span>
            <button onClick={() => events.length === limit && load(offset + limit)} disabled={events.length < limit}
              className="text-sm text-indigo-600 hover:text-indigo-700 disabled:opacity-40 font-medium">Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}
