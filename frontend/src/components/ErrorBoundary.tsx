import { Component, type ReactNode } from "react"
import { Link } from "react-router-dom"
import Logo from "./Logo"

/**
 * Catches render errors below it and shows a styled fallback so users never
 * see the white-screen-of-death. The original error is logged to the console
 * for triage.
 */

interface State { hasError: boolean; error: Error | null }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[Percy] Unhandled render error:", error, info)
  }

  reset = () => this.setState({ hasError: false, error: null })

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen flex flex-col bg-ink text-paper">
        <div className="h-14 shrink-0 border-b border-edge bg-surface flex items-center px-6 select-none">
          <Link to="/" onClick={this.reset} className="flex items-center gap-2.5">
            <Logo size={16} />
            <span className="wordmark text-[12px]">Percy</span>
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-lg text-center">
            <Logo size={56} tone="muted" className="opacity-50 mx-auto mb-6" />
            <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-3">— Something broke —</div>
            <h1 className="text-[26px] font-semibold tracking-[-0.01em] mb-3">
              Percy hit an unexpected error.
            </h1>
            <p className="text-[13px] text-muted leading-[1.7] mb-6">
              The page you were on crashed mid-render. The error has been logged.
              You can try again, or head home — your work is saved.
            </p>
            {this.state.error?.message && (
              <pre className="text-[11px] font-mono text-bad bg-bad/5 border border-bad/20 px-3 py-2 mb-6 text-left whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.reset}
                className="text-[10px] tracking-[0.16em] uppercase bg-paper text-ink hover:bg-paper/90 px-5 py-2 transition-colors font-medium"
              >
                Try again
              </button>
              <Link
                to="/home"
                onClick={this.reset}
                className="text-[10px] tracking-[0.16em] uppercase text-muted hover:text-paper border border-edge hover:bg-paper/5 px-5 py-2 transition-colors"
              >
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
