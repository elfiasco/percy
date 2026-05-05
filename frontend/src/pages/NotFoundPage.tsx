import { Link, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import Logo from "../components/Logo"

export default function NotFoundPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const loc = useLocation()

  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper">
      <div className="h-14 shrink-0 border-b border-edge bg-surface flex items-center px-6 select-none">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo size={16} />
          <span className="wordmark text-[12px]">Percy</span>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-lg text-center">
          <Logo size={56} tone="muted" className="opacity-50 mx-auto mb-6" />
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-3">— Page not found —</div>
          <h1 className="text-[28px] font-semibold tracking-[-0.01em] mb-3">
            We couldn't find that.
          </h1>
          <p className="text-[13px] text-muted leading-[1.7] mb-2">
            The path <span className="text-paper font-mono">{loc.pathname}</span> doesn't exist
            {user ? <> in your workspace.</> : <>, or you don't have access to it.</>}
          </p>
          <p className="text-[12px] text-muted leading-[1.7] mb-6">
            It may have been moved, renamed, or the link is just slightly off.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="text-[10px] tracking-[0.16em] uppercase text-muted hover:text-paper border border-edge hover:bg-paper/5 px-5 py-2 transition-colors"
            >
              ← Back
            </button>
            <Link
              to={user ? "/home" : "/"}
              className="text-[10px] tracking-[0.16em] uppercase bg-paper text-ink hover:bg-paper/90 px-5 py-2 transition-colors font-medium"
            >
              {user ? "Home" : "Sign in"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
