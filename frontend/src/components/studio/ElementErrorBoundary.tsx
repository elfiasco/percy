import { Component, type ReactNode } from "react"

/**
 * Per-element error boundary. If one element's renderer throws (Tiptap,
 * y-prosemirror, third-party chart lib, …), we want to fence the failure
 * to that element so the rest of the slide stays usable. The fallback is
 * a small inline marker; the global ErrorBoundary in the app shell stays
 * as the last-resort whole-page catch.
 *
 * Logs every catch to the console so we can triage what crashed even when
 * the user kept editing.
 */
interface State { hasError: boolean; message: string }

export default class ElementErrorBoundary extends Component<
  { children: ReactNode; elementId?: string; label?: string },
  State
> {
  state: State = { hasError: false, message: "" }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message || "Render failed" }
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error("[Percy] element render crash", {
      elementId: this.props.elementId,
      label:     this.props.label,
      error:     err,
      info,
    })
  }

  reset = () => this.setState({ hasError: false, message: "" })

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div
        onClick={(e) => { e.stopPropagation(); this.reset() }}
        title={`Renderer crashed: ${this.state.message}\n\nClick to retry.`}
        style={{
          width: "100%", height: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(239,68,68,0.08)",
          border: "1px dashed rgba(239,68,68,0.35)",
          color: "#b91c1c", fontSize: 9, fontFamily: "monospace",
          cursor: "pointer", userSelect: "none",
        }}
      >
        ! render failed — click to retry
      </div>
    )
  }
}
