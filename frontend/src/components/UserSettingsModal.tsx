import { useState, useEffect } from "react"
import { useAuth } from "../auth/AuthContext"

interface Settings {
  theme: string
  locale: string
  notifications: Record<string, boolean>
  default_org_id: string | null
  panel_states: Record<string, unknown>
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function UserSettingsModal({ open, onClose }: Props) {
  const { user, refresh } = useAuth()
  const [settings,    setSettings]    = useState<Settings>({ theme: "light", locale: "en", notifications: {}, default_org_id: null, panel_states: {} })
  const [displayName, setDisplayName] = useState(user?.display_name || "")
  const [currentPw,   setCurrentPw]   = useState("")
  const [newPw,       setNewPw]       = useState("")
  const [confirmPw,   setConfirmPw]   = useState("")
  const [saving,      setSaving]      = useState(false)
  const [pwSaving,    setPwSaving]    = useState(false)
  const [toast,       setToast]       = useState("")
  const [avatarFile,  setAvatarFile]  = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar_url || null)
  const [tab, setTab] = useState<"profile" | "preferences" | "security">("profile")

  useEffect(() => {
    if (!open) return
    setDisplayName(user?.display_name || "")
    setAvatarPreview(user?.avatar_url || null)
    fetch("/api/auth/settings", { credentials: "include" })
      .then(r => r.json())
      .then(d => setSettings(d))
      .catch(() => {})
  }, [open, user])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(""), 3000)
  }

  const saveProfile = async () => {
    setSaving(true)
    try {
      if (avatarFile) {
        const fd = new FormData()
        fd.append("file", avatarFile)
        await fetch("/api/auth/avatar", { method: "POST", credentials: "include", body: fd })
      }
      if (displayName !== user?.display_name) {
        await fetch("/api/auth/me", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ display_name: displayName }),
        })
      }
      await refresh()
      showToast("Profile saved")
    } catch {
      showToast("Failed to save profile")
    } finally {
      setSaving(false)
    }
  }

  const savePreferences = async () => {
    setSaving(true)
    try {
      await fetch("/api/auth/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: settings.theme, locale: settings.locale }),
      })
      document.documentElement.classList.toggle("dark", settings.theme === "dark")
      showToast("Preferences saved")
    } catch {
      showToast("Failed to save preferences")
    } finally {
      setSaving(false)
    }
  }

  const changePassword = async () => {
    if (newPw !== confirmPw)  { showToast("Passwords don't match"); return }
    if (newPw.length < 8)     { showToast("Password must be at least 8 characters"); return }
    setPwSaving(true)
    try {
      const r = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error((d as any).detail || "Failed to change password")
      }
      setCurrentPw(""); setNewPw(""); setConfirmPw("")
      showToast("Password changed successfully")
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Failed to change password")
    } finally {
      setPwSaving(false)
    }
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setAvatarFile(f)
    const reader = new FileReader()
    reader.onload = ev => setAvatarPreview(ev.target?.result as string)
    reader.readAsDataURL(f)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg w-[480px] max-w-[95vw] max-h-[85vh] flex flex-col shadow-2xl"
           onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div className="text-sm font-semibold text-paper">Account Settings</div>
          <button onClick={onClose} className="text-muted hover:text-paper text-lg w-7 h-7 rounded hover:bg-white/10">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-edge px-3">
          {(["profile", "preferences", "security"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs capitalize ${tab === t ? "text-paper border-b-2 border-accent" : "text-muted hover:text-paper"}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
          {tab === "profile" && (
            <div className="space-y-4">
              {/* Avatar */}
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-14 h-14 rounded-full bg-accent/20 flex items-center justify-center overflow-hidden border border-edge">
                    {avatarPreview
                      ? <img src={avatarPreview} className="w-full h-full object-cover" alt="Avatar" />
                      : <span className="text-xl font-bold text-accent">{(displayName || user?.email || "U")[0].toUpperCase()}</span>
                    }
                  </div>
                  <label className="absolute -bottom-1 -right-1 w-5 h-5 bg-surface border border-edge rounded-full flex items-center justify-center cursor-pointer shadow-sm hover:bg-paper/10">
                    <svg className="w-2.5 h-2.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a4 4 0 01-2.828 1.172H7v-2a4 4 0 011.172-2.828z" />
                    </svg>
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                  </label>
                </div>
                <div>
                  <p className="text-sm text-paper">{user?.email}</p>
                  <p className="text-[10px] text-muted mt-0.5">Click the pencil to change your photo</p>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Display name</label>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                  className="w-full text-sm bg-base border border-edge rounded px-2 py-1.5 text-paper focus:outline-none focus:border-accent" />
              </div>

              <div className="flex justify-end pt-1">
                <button onClick={saveProfile} disabled={saving}
                  className="text-sm px-3 py-1.5 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-50">
                  {saving ? "Saving…" : "Save profile"}
                </button>
              </div>
            </div>
          )}

          {tab === "preferences" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Theme</label>
                <select value={settings.theme} onChange={e => setSettings(s => ({...s, theme: e.target.value}))}
                  className="w-full text-sm bg-base border border-edge rounded px-2 py-1.5 text-paper focus:outline-none focus:border-accent">
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">System</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Language</label>
                <select value={settings.locale} onChange={e => setSettings(s => ({...s, locale: e.target.value}))}
                  className="w-full text-sm bg-base border border-edge rounded px-2 py-1.5 text-paper focus:outline-none focus:border-accent">
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="ja">Japanese</option>
                  <option value="zh">Chinese</option>
                </select>
              </div>
              <div className="flex justify-end pt-1">
                <button onClick={savePreferences} disabled={saving}
                  className="text-sm px-3 py-1.5 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-50">
                  {saving ? "Saving…" : "Save preferences"}
                </button>
              </div>
            </div>
          )}

          {tab === "security" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Current password</label>
                <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                  placeholder="Leave blank if using Google Sign-In"
                  className="w-full text-sm bg-base border border-edge rounded px-2 py-1.5 text-paper focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">New password</label>
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} minLength={8}
                  className="w-full text-sm bg-base border border-edge rounded px-2 py-1.5 text-paper focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Confirm new password</label>
                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                  className="w-full text-sm bg-base border border-edge rounded px-2 py-1.5 text-paper focus:outline-none focus:border-accent" />
              </div>
              <div className="flex justify-end pt-1">
                <button onClick={changePassword} disabled={pwSaving || !newPw}
                  className="text-sm px-3 py-1.5 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-50">
                  {pwSaving ? "Changing…" : "Change password"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="mx-4 mb-4 px-3 py-2 bg-paper/10 border border-edge text-paper text-xs rounded text-center">{toast}</div>
        )}
      </div>
    </div>
  )
}
