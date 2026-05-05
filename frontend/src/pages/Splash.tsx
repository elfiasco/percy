import { Link, Navigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import ThemeToggle from "../theme/ThemeToggle"
import Logo from "../components/Logo"

export default function Splash() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink text-muted text-sm">
        Loading…
      </div>
    )
  }
  if (user) return <Navigate to="/home" replace />

  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper relative overflow-hidden">

      {/* ── ambient watermark — massive phi bleeding off the right edge ─── */}
      <div
        className="pointer-events-none absolute -right-[18vw] top-1/2 -translate-y-1/2 select-none"
        style={{ width: "92vh", height: "92vh", maxWidth: "92vw", maxHeight: "92vh" }}
        aria-hidden
      >
        <Logo size="100%" tone="muted" className="opacity-[0.06] block splash-breathe" />
      </div>

      {/* registration-mark phi in the corner — like a print mark */}
      <div className="pointer-events-none absolute top-3 right-3 opacity-30 hidden md:block" aria-hidden>
        <Logo size={14} tone="muted" />
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 opacity-30 hidden md:block" aria-hidden>
        <Logo size={14} tone="muted" />
      </div>

      {/* ── top nav — slim ────────────────────────────────────────────── */}
      <div className="h-14 shrink-0 flex items-center justify-between px-8 border-b border-edge relative z-10">
        <div className="flex items-center gap-2.5">
          <Logo size={18} />
          <span className="wordmark text-[12px]">Percy</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle size="xs" />
          <Link to="/login"  className="text-[11px] uppercase tracking-[0.16em] text-muted hover:text-paper px-3 py-1.5">Sign in</Link>
          <Link
            to="/signup"
            className="text-[11px] uppercase tracking-[0.16em] bg-paper text-ink hover:bg-paper/90 px-4 py-1.5 transition-colors"
          >
            Get started
          </Link>
        </div>
      </div>

      {/* ── hero ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center px-6 sm:px-12 lg:px-20 relative z-10">
        <div className="max-w-2xl w-full">

          {/* sigil block — small mark above the eyebrow, a calling-card moment */}
          <div className="flex flex-col items-start mb-10">
            <Logo size={56} className="mb-5 splash-fade-in-1" />
            <div className="text-[10px] tracking-[0.32em] uppercase text-muted splash-fade-in-2">
              — Percy · Established 2026 —
            </div>
          </div>

          <h1 className="font-semibold leading-[1.04] tracking-[-0.02em] mb-7 splash-fade-in-3
                         text-[40px] sm:text-[56px] lg:text-[64px]">
            <span className="text-paper">Your business has a story.</span>
            <br />
            <span className="text-paper">Tell it well —</span>
            <br />
            <span className="text-muted">and keep it current.</span>
          </h1>

          <p className="text-[15px] text-muted max-w-xl leading-[1.7] mb-10 splash-fade-in-4">
            Percy turns the way your team works on presentations into something
            modern. Bring the decks you already have. We learn your style,
            keep your numbers honest, and make late-night updates a thing of the past.
          </p>

          <div className="flex items-center gap-3 splash-fade-in-5">
            <Link
              to="/signup"
              className="px-5 py-2.5 bg-paper text-ink hover:bg-paper/90 transition-colors text-[12px] tracking-[0.16em] uppercase font-medium"
            >
              Get started
            </Link>
            <Link
              to="/login"
              className="px-5 py-2.5 text-paper border border-edge hover:bg-paper/5 transition-colors text-[12px] tracking-[0.16em] uppercase"
            >
              Sign in
            </Link>
          </div>

          {/* three-act proof — slim columns */}
          <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-0 max-w-3xl text-left border-t border-edge splash-fade-in-6">
            <ProofCol n="I"   title="Bring your work"
                      body="Drop in the decks you already use. Percy reads them, learns your brand, and remembers the way your team frames numbers." />
            <ProofCol n="II"  title="Stay current"
                      body="Connect your data once. Charts and tables stay in sync — no more screenshots, no more stale figures, no more last-minute scrambles." />
            <ProofCol n="III" title="Ship anywhere" last
                      body="Refresh on a schedule or on demand. Export to PowerPoint, PDF, or share a live link. Your team always has the current cut." />
          </div>
        </div>
      </div>

      {/* ── footer ────────────────────────────────────────────────────── */}
      <div className="h-12 shrink-0 flex items-center justify-between px-8 border-t border-edge text-[10px] tracking-[0.18em] uppercase text-muted relative z-10">
        <span>© Percy · {new Date().getFullYear()}</span>
        <div className="flex items-center gap-5">
          <Link to="/terms"   className="hover:text-paper transition-colors">Terms</Link>
          <Link to="/privacy" className="hover:text-paper transition-colors">Privacy</Link>
          <span className="hidden sm:inline">For the people who tell the story.</span>
        </div>
      </div>

      {/* keyframes for the ambient watermark + staggered fade-ins.
         Inline so we don't need a global CSS edit; they're page-scoped class names. */}
      <style>{`
        @keyframes splash-breathe {
          0%, 100% { transform: scale(1)    rotate(0deg);   opacity: 0.06; }
          50%      { transform: scale(1.02) rotate(0.5deg); opacity: 0.085; }
        }
        .splash-breathe {
          animation: splash-breathe 16s ease-in-out infinite;
          transform-origin: center;
        }
        @keyframes splash-fade-in {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .splash-fade-in-1 { animation: splash-fade-in 700ms ease-out 80ms  both; }
        .splash-fade-in-2 { animation: splash-fade-in 700ms ease-out 200ms both; }
        .splash-fade-in-3 { animation: splash-fade-in 700ms ease-out 320ms both; }
        .splash-fade-in-4 { animation: splash-fade-in 700ms ease-out 460ms both; }
        .splash-fade-in-5 { animation: splash-fade-in 700ms ease-out 600ms both; }
        .splash-fade-in-6 { animation: splash-fade-in 700ms ease-out 760ms both; }
        @media (prefers-reduced-motion: reduce) {
          .splash-breathe, .splash-fade-in-1, .splash-fade-in-2, .splash-fade-in-3,
          .splash-fade-in-4, .splash-fade-in-5, .splash-fade-in-6 { animation: none; }
        }
      `}</style>
    </div>
  )
}

function ProofCol({ n, title, body, last }: { n: string; title: string; body: string; last?: boolean }) {
  return (
    <div className={`px-6 py-7 ${last ? "" : "md:border-r border-edge"}`}>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[10px] tracking-[0.18em] uppercase text-muted">{n}</span>
        <span className="text-[13px] tracking-[0.16em] uppercase text-paper">{title}</span>
      </div>
      <div className="text-[12px] text-muted leading-[1.7]">{body}</div>
    </div>
  )
}
