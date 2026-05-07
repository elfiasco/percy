import { useState } from "react"
import { useAuth } from "../auth/AuthContext"

interface Props {
  className?: string
}

export default function EmailVerificationBanner({ className = "" }: Props) {
  const { user } = useAuth()
  const [sent,      setSent]      = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Only show if logged in and email_verified is falsy
  if (!user || (user as any).email_verified || dismissed) return null

  const resend = async () => {
    setLoading(true)
    try {
      await fetch("/api/auth/send-verification", { method: "POST", credentials: "include" })
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between text-sm ${className}`}>
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
        </svg>
        <span className="text-amber-800">
          Please verify your email address.{" "}
          {sent ? (
            <span className="font-medium text-green-700">Verification email sent!</span>
          ) : (
            <button onClick={resend} disabled={loading}
              className="font-medium text-amber-900 underline hover:no-underline disabled:opacity-60">
              {loading ? "Sending…" : "Resend email"}
            </button>
          )}
        </span>
      </div>
      <button onClick={() => setDismissed(true)} className="text-amber-600 hover:text-amber-800 ml-4">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
