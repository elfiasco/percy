import { useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import ThemeToggle from "../theme/ThemeToggle"
import Logo from "../components/Logo"

export default function ForgotPassword() {
  const [email,     setEmail]     = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState("")

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setError("")
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      })
      // Always show "sent" regardless of whether the account exists,
      // to avoid leaking which emails are registered.
      setSubmitted(true)
    } catch {
      setError("Something went wrong. Please try again.")
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
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-3 text-center">— Reset password —</div>

          {submitted ? (
            <>
              <div className="text-[20px] font-semibold tracking-[-0.01em] text-paper mb-3 text-center">Check your email.</div>
              <p className="text-[12px] text-muted leading-[1.7] mb-6 text-center">
                If an account exists for <span className="text-paper">{email}</span>, you'll receive a link to reset
                your password within a minute.
              </p>
              <Link to="/login"
                className="block w-full text-center text-[12px] tracking-[0.16em] uppercase py-2 bg-paper text-ink hover:bg-paper/90 font-medium">
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <div className="text-[20px] font-semibold tracking-[-0.01em] text-paper mb-2 text-center">
                Forgot your password?
              </div>
              <p className="text-[12px] text-muted leading-[1.7] mb-5 text-center">
                Enter your email and we'll send you a link to set a new one.
              </p>
              <form onSubmit={onSubmit} className="space-y-3">
                {error && (
                  <div className="text-[11px] text-bad bg-bad/10 border border-bad/30 px-2 py-1.5">{error}</div>
                )}
                <input
                  type="email" required autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-sm bg-ink border border-edge px-3 py-2 text-paper focus:outline-none focus:border-paper/40"
                />
                <button type="submit" disabled={loading}
                  className="w-full text-[12px] tracking-[0.16em] uppercase py-2 bg-paper text-ink hover:bg-paper/90 transition-colors disabled:opacity-50 font-medium">
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
            </>
          )}

          <div className="mt-6 text-[11px] text-muted text-center">
            Remembered it?{" "}
            <Link to="/login" className="text-paper hover:underline">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
