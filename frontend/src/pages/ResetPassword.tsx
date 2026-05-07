import { useState, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Link } from "react-router-dom"
import ThemeToggle from "../theme/ThemeToggle"
import Logo from "../components/Logo"

export default function ResetPassword() {
  const [params] = useSearchParams()
  const [password, setPassword] = useState("")
  const [confirm,  setConfirm]  = useState("")
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState("")
  const [done,     setDone]     = useState(false)
  const navigate = useNavigate()
  const token = params.get("token") || ""

  useEffect(() => {
    if (!token) navigate("/login", { replace: true })
  }, [token, navigate])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError("Passwords don't match"); return }
    if (password.length < 8)  { setError("Password must be at least 8 characters"); return }
    setLoading(true)
    setError("")
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, new_password: password }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error((d as any).detail || "Reset failed")
      }
      setDone(true)
      setTimeout(() => navigate("/home", { replace: true }), 1500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper">
      <div className="h-14 shrink-0 flex items-center justify-between px-8 border-b border-edge">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo size={18} />
          <span className="wordmark text-[12px]">Percy</span>
        </Link>
        <ThemeToggle size="xs" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm bg-surface border border-edge p-8 shadow-2xl">
          <div className="flex justify-center mb-5"><Logo size={48} /></div>
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-3 text-center">— Set new password —</div>

          {done ? (
            <>
              <div className="text-[20px] font-semibold tracking-[-0.01em] text-paper mb-3 text-center">Password updated!</div>
              <p className="text-[12px] text-muted leading-[1.7] text-center">Redirecting you to the dashboard…</p>
            </>
          ) : (
            <>
              <div className="text-[20px] font-semibold tracking-[-0.01em] text-paper mb-2 text-center">
                Choose a new password
              </div>
              <p className="text-[12px] text-muted leading-[1.7] mb-5 text-center">
                Must be at least 8 characters.
              </p>
              <form onSubmit={submit} className="space-y-3">
                {error && (
                  <div className="text-[11px] text-bad bg-bad/10 border border-bad/30 px-2 py-1.5">{error}</div>
                )}
                <input
                  type="password" required autoFocus minLength={8}
                  placeholder="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full text-sm bg-ink border border-edge px-3 py-2 text-paper focus:outline-none focus:border-paper/40"
                />
                <input
                  type="password" required minLength={8}
                  placeholder="Confirm new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full text-sm bg-ink border border-edge px-3 py-2 text-paper focus:outline-none focus:border-paper/40"
                />
                <button type="submit" disabled={loading}
                  className="w-full text-[12px] tracking-[0.16em] uppercase py-2 bg-paper text-ink hover:bg-paper/90 transition-colors disabled:opacity-50 font-medium">
                  {loading ? "Saving…" : "Set new password"}
                </button>
              </form>
            </>
          )}

          <div className="mt-6 text-[11px] text-muted text-center">
            <Link to="/login" className="text-paper hover:underline">Back to sign in</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
