import { useState, useEffect, useCallback, useRef } from "react"
import type { ConnectorData, ConnectorDataUpdate } from "../../lib/studioTypes"
import { fetchConnectorData, updateConnectorData } from "../../lib/studioApi"

function SectionHead({ title }: { title: string }) {
  return <div className="text-[10px] uppercase tracking-widest text-muted mt-2 mb-1.5 first:mt-0">{title}</div>
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[11px] text-muted w-20 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function ColorBox({ value, onChange, allowClear }: {
  value: string | null
  onChange: (hex: string | null) => void
  allowClear?: boolean
}) {
  const [open, setOpen] = useState(false)
  const swatch = value || "#999999"
  return (
    <div className="relative inline-flex items-center gap-1.5">
      <button onClick={() => setOpen(true)}
        className="w-5 h-5 rounded border border-edge cursor-pointer shrink-0"
        style={{ background: value ? swatch : "repeating-linear-gradient(45deg, #555 0 4px, #333 4px 8px)" }} />
      <span className="text-[10px] font-mono text-muted/70">{value ?? "—"}</span>
      {open && (
        <div className="absolute z-50 top-6 left-0 bg-surface border border-edge rounded shadow-xl p-2 flex flex-col gap-1.5">
          <input type="color" value={swatch} autoFocus
            onChange={(e) => onChange(e.target.value.toUpperCase())} onBlur={() => setOpen(false)}
            className="w-24 h-6" />
          {allowClear && <button onClick={() => { onChange(null); setOpen(false) }} className="text-[10px] text-muted hover:text-bad">clear</button>}
        </div>
      )}
    </div>
  )
}

function NumBox({ value, onChange, step = 0.25, width = "w-16" }: {
  value: number | null | undefined; onChange: (v: number | null) => void; step?: number; width?: string
}) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value))
  useEffect(() => { setText(value === null || value === undefined ? "" : String(value)) }, [value])
  const commit = () => {
    const t = text.trim()
    if (!t) { onChange(null); return }
    const n = parseFloat(t); if (!isNaN(n)) onChange(n)
  }
  return (
    <input type="number" step={step} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
      className={`${width} text-[11px] font-mono bg-base border border-edge rounded px-1.5 py-0.5
                  text-slate-200 focus:outline-none focus:border-accent
                  [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} />
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={`relative w-7 h-3.5 rounded-full transition-colors ${on ? "bg-accent" : "bg-white/10 border border-edge"}`}>
      <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
    </button>
  )
}

function Selector<T extends string>({ value, onChange, options }: {
  value: T | null | undefined
  onChange: (v: T) => void
  options: ReadonlyArray<{ label: string; value: T }>
}) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value as T)}
      className="text-[11px] bg-base border border-edge rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-accent">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

const CONNECTOR_TYPES = [
  { label: "Straight", value: "straight" },
  { label: "Elbow",    value: "elbow" },
  { label: "Curved",   value: "curved" },
] as const

const ARROW_ENDS = [
  { label: "(none)",   value: "none"     },
  { label: "Arrow",    value: "arrow"    },
  { label: "Triangle", value: "triangle" },
  { label: "Stealth",  value: "stealth"  },
  { label: "Diamond",  value: "diamond"  },
  { label: "Oval",     value: "oval"     },
] as const

const ARROW_SIZES = [
  { label: "Sm",  value: "sm"  },
  { label: "Med", value: "med" },
  { label: "Lg",  value: "lg"  },
] as const

const DASH_STYLES = [
  { label: "Solid",  value: "solid" },
  { label: "Dash",   value: "dash" },
  { label: "Dot",    value: "dot" },
  { label: "DashDot", value: "dashDot" },
  { label: "Long",   value: "lgDash" },
] as const

interface Props { docId: string; slideN: number; elementId: string; onCommit: () => void }

export default function ConnectorEditorPanel({ docId, slideN, elementId, onCommit }: Props) {
  const [data, setData]     = useState<ConnectorData | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const pendingRef = useRef<ConnectorDataUpdate | null>(null)
  const flushTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null); setData(null)
    fetchConnectorData(docId, slideN, elementId)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [docId, slideN, elementId])

  const flush = useCallback(async () => {
    const update = pendingRef.current
    pendingRef.current = null
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
    if (!update) return
    setSaving(true)
    try {
      const fresh = await updateConnectorData(docId, slideN, elementId, update)
      setData(fresh)
      onCommit()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [docId, slideN, elementId, onCommit])

  const patch = useCallback((update: ConnectorDataUpdate) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        ...update,
        endpoints: update.endpoints ? { ...prev.endpoints, ...update.endpoints } : prev.endpoints,
        line:      update.line      ? { ...prev.line,      ...update.line      } : prev.line,
      }
    })
    pendingRef.current = { ...(pendingRef.current ?? {}), ...update }
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = window.setTimeout(() => { flush() }, 200)
  }, [flush])

  useEffect(() => {
    return () => { if (pendingRef.current) flush() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <div className="p-3 text-[11px] text-bad bg-bad/5 border border-bad/30 rounded m-2">{error}</div>
  if (!data) return <div className="p-3 text-[11px] text-muted">Loading…</div>

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex shrink-0 border-b border-edge/60 px-2 pt-1.5 bg-base/30">
        <span className="px-2 py-1 text-[10px] capitalize rounded-t bg-surface text-slate-200 border-t border-l border-r border-edge">Connector</span>
        <div className="flex-1" />
        <span className="text-[9px] text-muted/60 self-center pr-1">{saving ? "saving…" : ""}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 scrollbar-thin space-y-2">

        <SectionHead title="Type" />
        <div className="bg-base/40 border border-edge/60 rounded p-2">
          <Selector value={data.connector_type} onChange={(v) => patch({ connector_type: v })} options={CONNECTOR_TYPES} />
        </div>

        <SectionHead title="Endpoints (in)" />
        <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
          <FieldRow label="Start X">
            <NumBox value={data.endpoints.start_x} onChange={(v) => patch({ endpoints: { start_x: v ?? 0 } })} step={0.05} />
          </FieldRow>
          <FieldRow label="Start Y">
            <NumBox value={data.endpoints.start_y} onChange={(v) => patch({ endpoints: { start_y: v ?? 0 } })} step={0.05} />
          </FieldRow>
          <FieldRow label="End X">
            <NumBox value={data.endpoints.end_x} onChange={(v) => patch({ endpoints: { end_x: v ?? 0 } })} step={0.05} />
          </FieldRow>
          <FieldRow label="End Y">
            <NumBox value={data.endpoints.end_y} onChange={(v) => patch({ endpoints: { end_y: v ?? 0 } })} step={0.05} />
          </FieldRow>
          <button
            onClick={() => patch({ endpoints: { start_x: data.endpoints.end_x, start_y: data.endpoints.end_y, end_x: data.endpoints.start_x, end_y: data.endpoints.start_y } })}
            className="w-full text-[10px] py-1 mt-1 rounded bg-white/5 hover:bg-white/10 text-muted hover:text-slate-200 border border-edge"
          >⇄ Swap endpoints</button>
        </div>

        <SectionHead title="Line" />
        <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
          <FieldRow label="Visible">
            <Toggle on={data.line.visible} onChange={(v) => patch({ line: { visible: v } })} />
          </FieldRow>
          <FieldRow label="Color">
            <ColorBox value={data.line.color} onChange={(c) => patch({ line: { color: c } })} allowClear />
          </FieldRow>
          <FieldRow label="Width">
            <NumBox value={data.line.width} onChange={(v) => patch({ line: { width: v } })} step={0.25} />
          </FieldRow>
          <FieldRow label="Dash">
            <Selector value={data.line.dash_style} onChange={(v) => patch({ line: { dash_style: v } })} options={DASH_STYLES} />
          </FieldRow>
        </div>

        <SectionHead title="Arrowheads" />
        <div className="bg-base/40 border border-edge/60 rounded p-2 space-y-1">
          <FieldRow label="Tail end">
            <Selector value={data.line.tail_end ?? "none"} onChange={(v) => patch({ line: { tail_end: v === "none" ? null : v } })} options={ARROW_ENDS} />
          </FieldRow>
          <FieldRow label="Tail size">
            <Selector value={data.line.tail_size ?? "med"} onChange={(v) => patch({ line: { tail_size: v } })} options={ARROW_SIZES} />
          </FieldRow>
          <FieldRow label="Head end">
            <Selector value={data.line.head_end ?? "none"} onChange={(v) => patch({ line: { head_end: v === "none" ? null : v } })} options={ARROW_ENDS} />
          </FieldRow>
          <FieldRow label="Head size">
            <Selector value={data.line.head_size ?? "med"} onChange={(v) => patch({ line: { head_size: v } })} options={ARROW_SIZES} />
          </FieldRow>
        </div>
      </div>
    </div>
  )
}
