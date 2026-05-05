import { useState } from "react"
import { useAuth } from "../auth/AuthContext"
import { updateMe, changePassword } from "../lib/authApi"

interface Props { onClose: () => void }

export default function AccountSettings({ onClose }: Props) {
  const { user, refresh } = useAuth()
  const [tab, setTab] = useState<"profile" | "password">("profile")
  if (!user) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg w-[480px] max-w-[95vw] max-h-[85vh] flex flex-col shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div className="text-sm font-semibold text-slate-200">Account</div>
          <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg w-7 h-7 rounded hover:bg-white/10">×</button>
        </div>
        <div className="flex border-b border-edge px-3">
          {(["profile", "password"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs capitalize ${tab === t ? "text-slate-200 border-b-2 border-accent" : "text-muted hover:text-slate-300"}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
          {tab === "profile"  && <ProfileTab onSaved={refresh} />}
          {tab === "password" && <PasswordTab hasPassword={true} />}
        </div>
      </div>
    </div>
  )
}

function ProfileTab({ onSaved }: { onSaved: () => Promise<void> }) {
  const { user } = useAuth()
  const [name, setName] = useState(user?.display_name ?? "")
  const [avatar, setAvatar] = useState(user?.avatar_url ?? "")
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState<string | null>(null)

  if (!user) return null

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      await updateMe({ display_name: name, avatar_url: avatar || null })
      await onSaved()
      setMsg("Saved.")
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <Field label="Email">
        <div className="text-xs text-muted">{user.email}</div>
      </Field>
      <Field label="Display name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full text-sm bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent"
        />
      </Field>
      <Field label="Avatar URL">
        <input
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
          placeholder="https://…"
          className="w-full text-xs bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent"
        />
        <div className="text-[10px] text-muted/70 mt-1">Paste an image URL. Self-hosted upload comes later.</div>
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        {msg && <span className="text-[11px] text-muted self-center">{msg}</span>}
        <button onClick={save} disabled={busy}
          className="text-sm px-3 py-1.5 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}

function PasswordTab({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState("")
  const [next,    setNext]    = useState("")
  const [busy,    setBusy]    = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)
  const [err,     setErr]     = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null); setErr(null)
    try {
      await changePassword(hasPassword ? current : null, next)
      setMsg("Password updated.")
      setCurrent(""); setNext("")
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {hasPassword && (
        <Field label="Current">
          <input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)}
            className="w-full text-sm bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent" />
        </Field>
      )}
      <Field label="New password">
        <input type="password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)}
          className="w-full text-sm bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent" />
      </Field>
      {err && <div className="text-[11px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1">{err}</div>}
      <div className="flex justify-end gap-2 pt-2">
        {msg && <span className="text-[11px] text-good self-center">{msg}</span>}
        <button type="submit" disabled={busy || next.length < 8}
          className="text-sm px-3 py-1.5 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-50">
          {busy ? "Updating…" : "Update password"}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">{label}</label>
      {children}
    </div>
  )
}
