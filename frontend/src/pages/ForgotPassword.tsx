import { useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import ThemeToggle from "../theme/ThemeToggle"
import Logo from "../components/Logo"

/**
 * Placeholder until the backend reset endpoint exists. Submitting always
 * shows the same "if an account exists, we sent a link" copy — the right
 * UX even when the real flow ships, since it doesn't leak which emails
 * are registered.
 */
export default function ForgotPassword() {
  const [email,     setEmail]     = useState("")
  const [submitted, setSubmitted] = useState(false)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!email) return
    // Backend hook would go here. For now, we don't actually send anything;
    // the messaging is identical regardless.
    setSubmitted(true)
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
                <input
                  type="email" required autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-sm bg-ink border border-edge px-3 py-2 text-paper focus:outline-none focus:border-paper/40"
                />
                <button type="submit"
                  className="w-full text-[12px] tracking-[0.16em] uppercase py-2 bg-paper text-ink hover:bg-paper/90 transition-colors font-medium">
                  Send reset link
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
