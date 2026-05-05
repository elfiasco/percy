import { useTheme } from "./ThemeContext"

/** Two-state toggle. Pure text, hairline border. Click to flip. */
export default function ThemeToggle({ size = "sm" }: { size?: "sm" | "xs" }) {
  const { mode, toggle } = useTheme()
  const cls = size === "xs"
    ? "text-[9px] px-1.5 py-0.5"
    : "text-[10px] px-2 py-1"
  return (
    <button
      onClick={toggle}
      title={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
      className={`${cls} uppercase tracking-[0.16em] border border-edge text-muted hover:text-paper hover:bg-paper/5 transition-colors rounded-none`}
    >
      <span className={mode === "dark" ? "text-paper" : "text-muted"}>Dark</span>
      <span className="text-muted/60 mx-1">/</span>
      <span className={mode === "light" ? "text-paper" : "text-muted"}>Light</span>
    </button>
  )
}
