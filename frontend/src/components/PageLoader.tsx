import Logo from "./Logo"

/**
 * The standard "page is loading" state. The phi mark spins slowly under a
 * caption so even brief loading moments feel branded instead of plain.
 *
 *   <PageLoader />                      // default: "Loading…"
 *   <PageLoader caption="Opening project" />
 */

interface Props {
  caption?: string
}

export default function PageLoader({ caption = "Loading" }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-ink text-muted gap-4">
      <Logo size={36} tone="muted" spinning />
      <div className="text-[10px] tracking-[0.22em] uppercase text-muted/80">— {caption} —</div>
    </div>
  )
}

/** Compact inline variant — for inside cards, panels, etc. */
export function InlineLoader({ caption, size = 18 }: { caption?: string; size?: number }) {
  return (
    <div className="flex items-center gap-2 text-muted">
      <Logo size={size} tone="muted" spinning />
      {caption && <span className="text-[11px] text-muted">{caption}</span>}
    </div>
  )
}
