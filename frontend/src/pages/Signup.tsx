import { useState, type FormEvent } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { googleSigninUrl } from "../lib/authApi"
import ThemeToggle from "../theme/ThemeToggle"
import Logo from "../components/Logo"

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
])

function isPersonalDomain(email: string) {
  const at = email.indexOf("@")
  if (at < 0) return true
  return PERSONAL_DOMAINS.has(email.slice(at + 1).toLowerCase())
}

interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; hint: string | null }

/** A pragmatic password-strength heuristic. Not a security boundary on its
 *  own — the server enforces the actual minimums — but enough to coach the
 *  user to a stronger choice. */
function passwordStrength(pwd: string): Strength {
  if (!pwd) return { score: 0, label: "", hint: null }
  let score = 0
  if (pwd.length >= 8)  score++
  if (pwd.length >= 12) score++
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++
  if (/\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd)) score++
  // Common-password penalty (very small list — server should do the heavy lifting)
  if (/^(password|qwerty|letmein|admin|welcome|123456)\d*$/i.test(pwd)) score = 1

  const label = ["", "Weak", "Fair", "Good", "Strong"][score] || "Weak"
  const hint = score >= 4 ? null
             : score === 0 || score === 1 ? "Use 8+ characters with mixed case and a symbol."
             : score === 2 ? "Try mixing upper + lowercase letters."
             : "Add a number or symbol."
  return { score: score as Strength["score"], label, hint }
}

export default function Signup() {
  const { user, loading, signup } = useAuth()
  const navigate = useNavigate()
  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [name,     setName]     = useState("")
  const [error,    setError]    = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPwd,  setShowPwd]  = useState(false)
  const [pwdFocused, setPwdFocused] = useState(false)

  const strength = passwordStrength(password)
  const emailValid = email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const canSubmit = !!email && emailValid && password.length >= 8 && !submitting

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-ink text-muted text-sm">Loading…</div>
  if (user)    return <Navigate to="/home" replace />

  const personalHint = email && isPersonalDomain(email)
  const teamHint     = email && !isPersonalDomain(email) && email.includes("@")

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await signup(email, password, name || undefined)
      navigate("/home")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes("409") ? "An account with this email already exists." : msg)
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
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-3 text-center">— Begin —</div>
          <div className="text-2xl font-semibold tracking-[-0.01em] text-paper mb-6 text-center">Create your account.</div>

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
              type="text"
              placeholder="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm bg-ink border border-edge px-3 py-2 text-paper focus:outline-none focus:border-paper/40"
            />
            <input
              type="email" required autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full text-sm bg-ink border px-3 py-2 text-paper focus:outline-none ${
                email && !emailValid ? "border-bad/60 focus:border-bad" : "border-edge focus:border-paper/40"
              }`}
            />
            {email && !emailValid && (
              <div className="text-[10px] text-bad px-1">— That doesn't look like a valid email.</div>
            )}
            {personalHint && emailValid && (
              <div className="text-[10px] text-muted px-1">— Personal account. A private workspace will be created.</div>
            )}
            {teamHint && emailValid && (
              <div className="text-[10px] text-paper px-1">— Team account. You'll join your company workspace.</div>
            )}

            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                required minLength={8}
                placeholder="Password (8+ characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setPwdFocused(true)}
                onBlur={() => setPwdFocused(false)}
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

            {/* strength meter — appears once typing starts */}
            {password.length > 0 && (
              <div className="px-1">
                <div className="flex gap-1 mb-1">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className={`flex-1 h-1 transition-colors ${
                      i < strength.score
                        ? strength.score <= 1 ? "bg-bad"
                        : strength.score === 2 ? "bg-ochre"
                        : strength.score === 3 ? "bg-champagne"
                        : "bg-verdigris"
                        : "bg-paper/10"
                    }`} />
                  ))}
                </div>
                <div className={`text-[10px] tracking-[0.14em] uppercase ${
                  strength.score <= 1 ? "text-bad"
                  : strength.score === 2 ? "text-ochre"
                  : strength.score === 3 ? "text-champagne"
                  : "text-verdigris"
                }`}>
                  {strength.label}
                  {pwdFocused && strength.hint && (
                    <span className="text-muted normal-case tracking-normal ml-2">— {strength.hint}</span>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="text-[11px] text-bad bg-bad/10 border border-bad/30 px-2 py-1.5">{error}</div>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full text-[12px] tracking-[0.16em] uppercase py-2 bg-paper text-ink hover:bg-paper/90 transition-colors disabled:opacity-40 font-medium"
            >
              {submitting ? "Creating…" : "Create account"}
            </button>

            <div className="text-[10px] text-muted/70 text-center leading-relaxed pt-1">
              By creating an account, you agree to Percy's{" "}
              <Link to="/terms" className="underline hover:text-paper">Terms</Link>
              {" "}and{" "}
              <Link to="/privacy" className="underline hover:text-paper">Privacy Policy</Link>.
            </div>
          </form>

          <div className="mt-6 text-[11px] text-muted text-center">
            Have an account?{" "}
            <Link to="/login" className="text-paper hover:underline">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
