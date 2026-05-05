import { useState, type FormEvent } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { googleSigninUrl } from "../lib/authApi"
import ThemeToggle from "../theme/ThemeToggle"
import Logo from "../components/Logo"

export default function Login() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [error,    setError]    = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPwd,  setShowPwd]  = useState(false)

  if (loading) return <Loading />
  if (user)    return <Navigate to="/home" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password)
      navigate("/home")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes("401") ? "Wrong email or password." : msg)
    } finally {
      setSubmitting(false)
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
          <div className="flex justify-center mb-5">
            <Logo size={48} />
          </div>
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-3 text-center">— Sign in —</div>
          <div className="text-2xl font-semibold tracking-[-0.01em] text-paper mb-6">Welcome back.</div>

          <a
            href={googleSigninUrl("/home")}
            className="flex items-center justify-center gap-2 w-full text-[12px] tracking-[0.08em] py-2 border border-edge text-paper hover:bg-paper/5 transition-colors mb-4"
          >
            <svg width="16" height="16" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.61z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.65 9c0-.6.1-1.16.3-1.7V4.97H.96a9 9 0 0 0 0 8.06l2.99-2.33z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.34l2.58-2.58A9 9 0 0 0 .96 4.97L3.95 7.3C4.66 5.18 6.65 3.58 9 3.58z"/>
            </svg>
            Continue with Google
          </a>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-edge" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted">or</span>
            <div className="flex-1 h-px bg-edge" />
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email" required autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full text-sm bg-ink border border-edge px-3 py-2 text-paper focus:outline-none focus:border-paper/40"
            />
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full text-sm bg-ink border border-edge px-3 py-2 pr-10 text-paper focus:outline-none focus:border-paper/40"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-paper text-[10px] tracking-[0.14em] uppercase px-1"
                aria-label={showPwd ? "Hide password" : "Show password"}
              >
                {showPwd ? "Hide" : "Show"}
              </button>
            </div>
            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-[10px] text-muted hover:text-paper tracking-[0.08em]">
                Forgot password?
              </Link>
            </div>
            {error && (
              <div className="text-[11px] text-bad bg-bad/10 border border-bad/30 px-2 py-1.5">{error}</div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full text-[12px] tracking-[0.16em] uppercase py-2 bg-paper text-ink hover:bg-paper/90 transition-colors disabled:opacity-50 font-medium"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 text-[11px] text-muted text-center">
            New here?{" "}
            <Link to="/signup" className="text-paper hover:underline">Create an account</Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function Loading() {
  return <div className="min-h-screen flex items-center justify-center bg-ink text-muted text-sm">Loading…</div>
}
