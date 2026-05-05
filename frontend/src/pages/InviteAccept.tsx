import { useEffect, useState } from "react"
import { useNavigate, useSearchParams, Link } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { acceptInvite } from "../lib/authApi"

export default function InviteAccept() {
  const { user, loading, refresh } = useAuth()
  const [params] = useSearchParams()
  const token = params.get("token") || ""
  const [status, setStatus] = useState<"idle" | "accepting" | "ok" | "error">("idle")
  const [error,  setError]  = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    if (!user) {
      // Send to login with this URL as the redirect target
      const ret = `/invite/accept?token=${encodeURIComponent(token)}`
      navigate(`/login?redirect=${encodeURIComponent(ret)}`, { replace: true })
      return
    }
    if (!token) { setStatus("error"); setError("Missing invite token."); return }
    if (status !== "idle") return
    setStatus("accepting")
    acceptInvite(token)
      .then(async () => {
        await refresh()
        setStatus("ok")
        setTimeout(() => navigate("/home"), 1200)
      })
      .catch((e) => {
        setStatus("error")
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [loading, user, token, status, navigate, refresh])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-base text-slate-200 gap-3 px-4 text-center">
      {status === "accepting" && <div className="text-sm text-muted">Accepting invite…</div>}
      {status === "ok" && (
        <>
          <div className="text-2xl">🎉</div>
          <div className="text-sm">You're in. Redirecting to your home…</div>
        </>
      )}
      {status === "error" && (
        <>
          <div className="text-sm text-bad">Couldn't accept this invite</div>
          <div className="text-xs text-muted/70 max-w-md">{error}</div>
          <Link to="/home" className="text-xs px-3 py-1 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40">
            Go to home
          </Link>
        </>
      )}
    </div>
  )
}
