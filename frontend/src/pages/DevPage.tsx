import { Navigate, Link } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import LegacyApp from "../App"

/**
 * DevPage — round-trip diagnostics, vision-grade, rebuild comparison view.
 * This is the original Percy dev tool, kept around for verifying that Bridge
 * elements survive python-pptx rebuild. Hidden from regular users.
 */
export default function DevPage() {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-base text-muted text-sm">Loading…</div>
  if (!user)   return <Navigate to="/login" replace />
  if (!user.is_admin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-base text-muted gap-3">
        <div className="text-sm text-bad">/dev is admin-only</div>
        <Link to="/home" className="text-xs px-3 py-1 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40">
          Back to home
        </Link>
      </div>
    )
  }
  return (
    <div className="min-h-screen bg-base">
      <div className="h-8 shrink-0 border-b border-bad/40 bg-bad/10 flex items-center px-4 text-[11px] text-bad/80 select-none">
        <span className="font-medium">/dev — round-trip diagnostics. Internal use.</span>
        <div className="flex-1" />
        <Link to="/home" className="hover:text-bad underline">← Home</Link>
      </div>
      <LegacyApp />
    </div>
  )
}
