import { useState, useEffect, useCallback } from "react"
import {
  listOrgMembers, updateMemberRole, removeMember,
  listInvites, createInvite, revokeInvite, updateOrg,
  type OrgInvite, type Org,
} from "../lib/authApi"
import { useAuth } from "../auth/AuthContext"
import { useToast, useDialog } from "../components/Toaster"

interface Props {
  org: Org
  onClose: () => void
}

interface Member {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  role: string
  joined_at: number
}

const ROLES = ["owner", "admin", "member"] as const

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted mb-0.5">{label}</div>
      <div className="text-xs text-slate-200">{children}</div>
    </div>
  )
}

export default function OrgSettings({ org, onClose }: Props) {
  const { user, refresh: refreshAuth } = useAuth()
  const [tab, setTab] = useState<"members" | "invites" | "general">("general")
  const [orgName, setOrgName] = useState(org.name)
  const [savingName, setSavingName] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<OrgInvite[]>([])
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [newRole,  setNewRole]  = useState("member")
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null)

  const isAdmin = (org.role === "owner" || org.role === "admin")
  const isOwner = org.role === "owner"

  const refresh = useCallback(async () => {
    try {
      const m = await listOrgMembers(org.id)
      setMembers(m.members as Member[])
      if (isAdmin) {
        const inv = await listInvites(org.id)
        setInvites(inv.invites)
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [org.id, isAdmin])

  useEffect(() => { refresh() }, [refresh])

  const toast  = useToast()
  const dialog = useDialog()

  const onChangeRole = async (uid: string, role: string) => {
    setBusy(true)
    try { await updateMemberRole(org.id, uid, role); await refresh() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e), "Couldn't update role") }
    finally  { setBusy(false) }
  }

  const onRemove = async (uid: string, name: string) => {
    const ok = await dialog.confirm({
      title:        `Remove ${name}?`,
      body:         `${name} will lose access to ${org.name} and all its projects.`,
      confirmLabel: "Remove member",
      danger:       true,
    })
    if (!ok) return
    setBusy(true)
    try { await removeMember(org.id, uid); await refresh(); toast.success(`${name} removed.`) }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e), "Couldn't remove member") }
    finally  { setBusy(false) }
  }

  const onSendInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmail.includes("@")) return
    setBusy(true)
    try {
      const inv = await createInvite(org.id, newEmail, newRole)
      setLastInviteUrl(`${window.location.origin}/invite/accept?token=${inv.token}`)
      setNewEmail("")
      await refresh()
      toast.success(`Invite sent to ${inv.email}.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e), "Couldn't send invite") }
    finally    { setBusy(false) }
  }

  const onRevoke = async (id: string) => {
    setBusy(true)
    try { await revokeInvite(id); await refresh(); toast.success("Invite revoked.") }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally  { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg w-[640px] max-w-[95vw] max-h-[85vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div>
            <div className="text-sm font-semibold text-slate-200">{org.name}</div>
            <div className="text-[10px] text-muted uppercase tracking-wider">{org.kind} · your role: {org.role}</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg w-7 h-7 rounded hover:bg-white/10">×</button>
        </div>
        <div className="flex border-b border-edge px-3">
          {(["general", "members", "invites"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs capitalize ${tab === t ? "text-slate-200 border-b-2 border-accent" : "text-muted hover:text-slate-300"}`}>
              {t === "general" ? "General" : t === "members" ? `Members · ${members.length}` : `Invites · ${invites.length}`}
            </button>
          ))}
        </div>

        {error && <div className="m-3 text-xs text-bad bg-bad/10 border border-bad/30 rounded px-3 py-2">{error}</div>}

        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
          {tab === "general" && (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Workspace name</label>
                <div className="flex gap-2">
                  <input
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    disabled={!isAdmin}
                    className="flex-1 text-sm bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent disabled:opacity-60"
                  />
                  {isAdmin && (
                    <button
                      onClick={async () => {
                        const n = orgName.trim()
                        if (!n || n === org.name) return
                        setSavingName(true)
                        try { await updateOrg(org.id, { name: n }); await refreshAuth(); toast.success("Workspace renamed.") }
                        catch (e) { toast.error(e instanceof Error ? e.message : String(e), "Rename failed") }
                        finally  { setSavingName(false) }
                      }}
                      disabled={savingName || orgName.trim() === org.name || !orgName.trim()}
                      className="text-sm px-3 py-1.5 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-40"
                    >Save</button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <Field label="Type">{org.kind}</Field>
                <Field label="Slug">{org.slug}</Field>
                {org.domain && <Field label="Domain">{org.domain}</Field>}
                <Field label="Your role">{org.role}</Field>
              </div>
              {!isAdmin && (
                <div className="text-[11px] text-muted/70 italic">Only org admins/owners can change these settings.</div>
              )}
            </div>
          )}
          {tab === "members" && (
            <div className="space-y-1.5">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 p-2 rounded hover:bg-white/5">
                  <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-xs text-accent overflow-hidden">
                    {m.avatar_url ? <img src={m.avatar_url} alt="" className="w-full h-full object-cover" /> : m.display_name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200 truncate">{m.display_name}{m.id === user?.id && <span className="text-muted/60 text-xs ml-1">(you)</span>}</div>
                    <div className="text-[10px] text-muted truncate">{m.email}</div>
                  </div>
                  {isAdmin && m.id !== user?.id ? (
                    <select
                      value={m.role}
                      onChange={(e) => onChangeRole(m.id, e.target.value)}
                      disabled={busy || (!isOwner && m.role === "owner")}
                      className="text-xs bg-base border border-edge rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-accent"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span className="text-[10px] text-muted uppercase tracking-wide">{m.role}</span>
                  )}
                  {isAdmin && m.id !== user?.id && (
                    <button onClick={() => onRemove(m.id, m.display_name)}
                      className="text-muted hover:text-bad text-sm w-6 h-6 rounded hover:bg-bad/10">×</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "invites" && (
            <div className="space-y-3">
              {isAdmin ? (
                <form onSubmit={onSendInvite} className="bg-base/40 border border-edge rounded p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted mb-2">Send invite</div>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      placeholder="person@example.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="flex-1 text-xs bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent"
                    />
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                      className="text-xs bg-base border border-edge rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-accent"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button type="submit" disabled={busy || !newEmail.includes("@")}
                      className="text-xs px-3 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-40">
                      Send
                    </button>
                  </div>
                  {lastInviteUrl && (
                    <div className="mt-2 text-[10px] text-muted">
                      Link (no email yet — copy + share):
                      <code className="ml-1 px-1 bg-base/80 border border-edge rounded text-[10px] break-all">{lastInviteUrl}</code>
                    </div>
                  )}
                </form>
              ) : (
                <div className="text-[11px] text-muted italic">Only admins can manage invites.</div>
              )}

              <div className="space-y-1.5">
                {invites.length === 0 ? (
                  <div className="text-[11px] text-muted italic">No pending invites.</div>
                ) : invites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 p-2 rounded hover:bg-white/5">
                    <div className="text-base">✉️</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-200 truncate">{inv.email}</div>
                      <div className="text-[10px] text-muted">role: {inv.role} · expires {new Date(inv.expires_at * 1000).toLocaleDateString()}</div>
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/invite/accept?token=${inv.token}`)}
                      className="text-[10px] px-2 py-1 rounded text-muted hover:text-slate-200 border border-edge hover:bg-white/10">copy link</button>
                    {isAdmin && (
                      <button onClick={() => onRevoke(inv.id)}
                        className="text-muted hover:text-bad text-sm w-6 h-6 rounded hover:bg-bad/10">×</button>
                    )}
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
