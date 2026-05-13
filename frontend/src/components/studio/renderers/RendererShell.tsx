import { useEffect, useRef } from "react"

/**
 * Shared loading/error/retry surface for native renderers.
 *
 * Before this component, each of the 11 renderers (Tiptap text, Tiptap table,
 * Bridge shape/image/freeform, chart, table, connector, …) independently
 * implemented:
 *   1. A `data-percy-loading` placeholder div while its payload is null
 *   2. A `data-percy-error` placeholder div when its payload fetch failed
 *   3. An auto-retry effect that re-fires the loader after a backoff
 * Each one slightly different. The fidelity test relies on those data-attrs
 * to wait for the slide to settle before screenshotting (see
 * `frontend/tests/roundtrip/fidelity.mjs`). Centralizing them here keeps the
 * contract consistent and the retry logic in one place.
 *
 * Usage:
 *
 *   const { content, loading, error } = useMyPayload(...)
 *   return (
 *     <RendererShell loading={loading} error={error} kind="my-kind" onRetry={reload}>
 *       {content && <MyActualContent ... />}
 *     </RendererShell>
 *   )
 */
export interface RendererShellProps {
  /** Truthy while the payload is being fetched. */
  loading?: boolean | null
  /** Truthy when the last fetch failed. */
  error?:   string | null
  /** Kind hint for `data-percy-loading="..."` (e.g. "text", "chart"). */
  kind:     string
  /** Optional retry callback. When provided, the error state auto-fires it
   *  after a short delay; the user can also click the error placeholder. */
  onRetry?: () => void
  /** Auto-retry backoff in ms. Default 1200. */
  retryDelayMs?: number
  /** The actual rendered content. Returned as-is when not loading and no error. */
  children: React.ReactNode
}

const ERR_STYLE: React.CSSProperties = {
  width: "100%", height: "100%",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "rgba(239,68,68,0.08)",
  border: "1px dashed rgba(239,68,68,0.35)",
  color: "#b91c1c",
  fontSize: 9, fontFamily: "monospace",
  cursor: "pointer", userSelect: "none",
}

export function RendererShell({
  loading,
  error,
  kind,
  onRetry,
  retryDelayMs = 1200,
  children,
}: RendererShellProps): React.ReactElement {
  const retryFiredRef = useRef(false)

  useEffect(() => {
    if (!error) {
      retryFiredRef.current = false
      return
    }
    if (!onRetry || retryFiredRef.current) return
    retryFiredRef.current = true
    const t = window.setTimeout(() => onRetry(), retryDelayMs)
    return () => clearTimeout(t)
  }, [error, onRetry, retryDelayMs])

  if (error) {
    return (
      <div
        data-percy-error={kind}
        style={ERR_STYLE}
        onClick={(e) => { e.stopPropagation(); onRetry?.() }}
        title={`Renderer error (${kind}): ${error}\n\nClick to retry.`}
      >
        ! {kind} load failed
      </div>
    )
  }
  if (loading) {
    return (
      <div
        data-percy-loading={kind}
        style={{ width: "100%", height: "100%" }}
      />
    )
  }
  return <>{children}</>
}
