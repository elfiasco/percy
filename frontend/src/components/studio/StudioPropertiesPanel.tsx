import { useState, useEffect, useCallback, useRef } from "react"
import type { StudioElement, ElementStyleData } from "../../lib/studioTypes"
import { fetchElementStyle, setSlideBackground, setAllSlidesBackground, setGradientBackground, replaceImage, fetchThemeColors, fetchDocStats, setSlideBackgroundImage, bulkUpdateStyle, setSlideTransition, fetchSlideTransitions, setElementAnimation, generateAltText, elementPngUrl } from "../../lib/studioApi"
import { commitElementFlags, commitElementGeometry, commitElementStyle } from "../../lib/studio/commands"
import type { DocStats } from "../../lib/studioApi"
import StudioTextPanel from "./StudioTextPanel"
import ChartEditorPanel from "./ChartEditorPanel"
import TableEditorPanel from "./TableEditorPanel"
import ConnectorEditorPanel from "./ConnectorEditorPanel"

const TYPE_COLOR: Record<string, string> = {
  BridgeShape:     "#6366F1",
  BridgeText:      "#22C55E",
  BridgeChart:     "#F59E0B",
  BridgeTable:     "#A855F7",
  BridgeImage:     "#EC4899",
  BridgeFreeform:  "#06B6D4",
  BridgeConnector: "#94A3B8",
}

const TEXT_CAPABLE    = new Set(["BridgeText", "BridgeShape", "BridgeFreeform", "BridgeChart", "BridgeTable"])
const STYLE_CAPABLE   = new Set(["BridgeShape", "BridgeText", "BridgeFreeform", "BridgeImage", "BridgeConnector"])
const FILL_CAPABLE    = new Set(["BridgeShape", "BridgeFreeform"])
const IMAGE_CAPABLE   = new Set(["BridgeImage"])

const DASH_OPTIONS = ["solid", "dash", "dot", "dash_dot", "long_dash", "long_dash_dot"] as const

// ── tiny reusable components ──────────────────────────────────────────────────

function SectionHead({ title }: { title: string }) {
  return (
    <div className="text-[10px] text-muted uppercase tracking-widest font-semibold mb-2 mt-3 first:mt-0">
      {title}
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <span className="text-[11px] text-muted shrink-0 w-[4.5rem]">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function NumInput({
  value, step = 0.001, min, max, disabled = false,
  onChange, onCommit, suffix,
}: {
  value: string; step?: number; min?: number; max?: number; disabled?: boolean
  onChange: (v: string) => void; onCommit: () => void; suffix?: string
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onCommit() } }}
        onBlur={onCommit}
        className="flex-1 min-w-0 text-xs font-mono bg-base border border-edge rounded px-1.5 py-0.5
                   text-slate-200 focus:outline-none focus:border-accent
                   disabled:opacity-35 disabled:cursor-default
                   [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && <span className="text-[10px] text-muted shrink-0">{suffix}</span>}
    </div>
  )
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => { setText(value) }, [value])

  const safeHex = (s: string) => /^#[0-9A-Fa-f]{6}$/.test(s) ? s : value

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={safeHex(text)}
        onChange={(e) => { setText(e.target.value); onChange(e.target.value) }}
        className="w-6 h-6 rounded border border-edge cursor-pointer bg-transparent p-0.5 shrink-0"
      />
      <input
        type="text"
        value={text}
        maxLength={7}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { const v = safeHex(text); setText(v); onChange(v) }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = safeHex(text); setText(v); onChange(v)
          }
        }}
        placeholder="#RRGGBB"
        className="flex-1 min-w-0 text-xs font-mono bg-base border border-edge rounded px-1.5 py-0.5
                   text-slate-200 focus:outline-none focus:border-accent"
      />
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-4 w-8 shrink-0 items-center rounded-full transition-colors
                  ${on ? "bg-accent" : "bg-edge"}`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform
                    ${on ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  )
}

// ── Position tab ──────────────────────────────────────────────────────────────

interface PositionTabProps {
  element: StudioElement
  docId: string
  slideN: number
  onCommit: () => void
}

function PositionTab({ element, docId, slideN, onCommit }: PositionTabProps) {
  const [x, setX] = useState(element.left_in.toFixed(3))
  const [y, setY] = useState(element.top_in.toFixed(3))
  const [w, setW] = useState(element.width_in.toFixed(3))
  const [h, setH] = useState(element.height_in.toFixed(3))
  const [rot, setRot] = useState(element.rotation.toFixed(1))
  const [editName, setEditName] = useState(element.name)

  useEffect(() => {
    setX(element.left_in.toFixed(3))
    setY(element.top_in.toFixed(3))
    setW(element.width_in.toFixed(3))
    setH(element.height_in.toFixed(3))
    setRot(element.rotation.toFixed(1))
    setEditName(element.name)
  }, [element])

  const commitPos = useCallback(async () => {
    const lx = parseFloat(x), ly = parseFloat(y)
    const lw = parseFloat(w), lh = parseFloat(h)
    if ([lx, ly, lw, lh].some(isNaN)) return
    const updated = await commitElementGeometry(element.id, {
      left_in: lx, top_in: ly, width_in: lw, height_in: lh,
    })
    if (!updated) return
    setX(updated.left_in.toFixed(3))
    setY(updated.top_in.toFixed(3))
    setW(updated.width_in.toFixed(3))
    setH(updated.height_in.toFixed(3))
    onCommit()
  }, [x, y, w, h, docId, slideN, element.id, onCommit])

  const commitRot = useCallback(async () => {
    const r = parseFloat(rot)
    if (isNaN(r)) return
    const updated = await commitElementGeometry(element.id, { rotation: r })
    if (!updated) return
    setRot(updated.rotation.toFixed(1))
    onCommit()
  }, [rot, docId, slideN, element.id, onCommit])

  const commitName = useCallback(async () => {
    const n = editName.trim()
    if (!n || n === element.name) return
    try {
      await commitElementGeometry(element.id, { name: n })
      onCommit()
    } catch (e) { console.error("rename failed:", e) }
  }, [editName, element.name, element.id, docId, slideN, onCommit])

  return (
    <div className="p-3 overflow-y-auto flex-1 scrollbar-thin">
      <SectionHead title="Position" />
      <FieldRow label="X (left)">
        <NumInput value={x} onChange={setX} onCommit={commitPos} suffix="in" />
      </FieldRow>
      <FieldRow label="Y (top)">
        <NumInput value={y} onChange={setY} onCommit={commitPos} suffix="in" />
      </FieldRow>
      <FieldRow label="Width">
        <NumInput value={w} onChange={setW} onCommit={commitPos} suffix="in" />
      </FieldRow>
      <FieldRow label="Height">
        <NumInput value={h} onChange={setH} onCommit={commitPos} suffix="in" />
      </FieldRow>

      <SectionHead title="Transform" />
      <FieldRow label="Rotation">
        <div className="flex items-center gap-1">
          <NumInput value={rot} step={1} onChange={setRot} onCommit={commitRot} suffix="°" />
          <button
            onClick={() => { setRot("0"); commitElementGeometry(element.id, { rotation: 0 }).then(onCommit) }}
            title="Reset rotation to 0°"
            className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted hover:bg-white/10 hover:text-slate-200 border border-edge shrink-0"
          >
            0°
          </button>
        </div>
      </FieldRow>
      <FieldRow label="Flip">
        <div className="flex gap-1">
          <button
            onClick={() => commitElementGeometry(element.id, { flip_h: !element.flip_h }).then(onCommit)}
            title="Flip horizontally"
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              element.flip_h
                ? "bg-paper/20 text-paper border-paper/40"
                : "bg-white/5 text-muted hover:bg-white/10 hover:text-slate-200 border-edge"
            }`}
          >
            ↔ H
          </button>
          <button
            onClick={() => commitElementGeometry(element.id, { flip_v: !element.flip_v }).then(onCommit)}
            title="Flip vertically"
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              element.flip_v
                ? "bg-paper/20 text-paper border-paper/40"
                : "bg-white/5 text-muted hover:bg-white/10 hover:text-slate-200 border-edge"
            }`}
          >
            ↕ V
          </button>
        </div>
      </FieldRow>

      <SectionHead title="Stack" />
      <div className="flex gap-1 mb-2">
        {[
          { label: "⤒", title: "Bring to Front", delta: 9999 },
          { label: "↑", title: "Bring Forward",  delta: 1 },
          { label: "↓", title: "Send Backward",  delta: -1 },
          { label: "⤓", title: "Send to Back",   delta: -9999 },
        ].map(({ label, title, delta }) => (
          <button
            key={title}
            title={title}
            onClick={async () => {
              const newZ = delta > 999 ? 9999 : delta < -999 ? 0 : Math.max(0, element.z_index + delta)
              try { await commitElementGeometry(element.id, { z_index: newZ }); onCommit() }
              catch (e) { console.error("z-order failed:", e) }
            }}
            className="flex-1 text-xs py-1 rounded bg-white/5 border border-edge hover:bg-white/10 text-slate-300"
          >
            {label}
          </button>
        ))}
      </div>
      <FieldRow label="Z-index">
        <span className="text-xs font-mono text-slate-300">{element.z_index}</span>
      </FieldRow>
      <FieldRow label="Index">
        <span className="text-xs font-mono text-slate-300">{element.index}</span>
      </FieldRow>
      <FieldRow label="Locked">
        <Toggle
          on={element.locked}
          onChange={async (v) => {
            try {
              const updated = await commitElementFlags(element.id, { locked: v })
              onCommit()
              // propagate updated element — parent will re-set via setSelectedElement
              void updated
            } catch (e) { console.error("lock toggle failed:", e) }
          }}
        />
      </FieldRow>
      <FieldRow label="Hidden">
        <Toggle
          on={element.hidden}
          onChange={async (v) => {
            try {
              const updated = await commitElementFlags(element.id, { hidden: v })
              onCommit()
              void updated
            } catch (e) { console.error("hidden toggle failed:", e) }
          }}
        />
      </FieldRow>

      <SectionHead title="Entrance Animation" />
      <div className="flex flex-wrap gap-1 mt-1">
        {(["none","fade-in","slide-left","slide-right","slide-up","slide-down","zoom-in","bounce"] as const).map((anim) => {
          const ANIM_ICONS: Record<string, string> = {
            "none": "—", "fade-in": "◌", "slide-left": "←", "slide-right": "→",
            "slide-up": "↑", "slide-down": "↓", "zoom-in": "⊕", "bounce": "⬍",
          }
          return (
            <button
              key={anim}
              onClick={async () => {
                try {
                  await setElementAnimation(docId, slideN, element.id, anim)
                  onCommit()
                } catch (e) { console.error("set animation failed:", e) }
              }}
              className={`text-[10px] px-1.5 py-0.5 rounded border capitalize transition-colors flex items-center gap-0.5 ${
                (element.animation ?? "none") === anim
                  ? "bg-paper/30 text-paper border-paper/40"
                  : "bg-white/5 text-muted border-edge hover:bg-white/10 hover:text-slate-300"
              }`}
              title={`${anim} entrance animation (used in HTML export)`}
            >
              <span className="text-[9px] opacity-70">{ANIM_ICONS[anim] ?? "·"}</span>
              {anim === "none" ? "none" : anim.replace("-", " ")}
            </button>
          )
        })}
      </div>

      <SectionHead title="Info" />
      <FieldRow label="Type">
        <span className="text-xs text-slate-300">{element.label}</span>
      </FieldRow>
      <FieldRow label="ID">
        <span className="text-[10px] font-mono text-muted break-all leading-tight">{element.id}</span>
      </FieldRow>
      <FieldRow label="Name">
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitName() } }}
          className="w-full text-xs bg-base border border-edge rounded px-1.5 py-0.5
                     text-slate-200 focus:outline-none focus:border-accent"
        />
      </FieldRow>

      <SectionHead title="Export" />
      <a
        href={elementPngUrl(docId, slideN, element.id)}
        download={`element-${element.id.slice(0, 8)}.png`}
        title="Download this element rendered as a transparent PNG"
        className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-edge
                   bg-white/5 text-muted hover:text-slate-200 hover:bg-white/10 transition-colors
                   no-underline w-full"
      >
        ↓ Download as PNG
      </a>

      <div className="mt-4 text-[10px] text-muted/60 leading-relaxed">
        Drag to move · Handles to resize · Arrow keys to nudge · Shift×10
      </div>
    </div>
  )
}

// ── Style tab ─────────────────────────────────────────────────────────────────

interface StyleTabProps {
  element: StudioElement
  docId: string
  slideN: number
  onCommit: () => void
}

function ThemeSwatches({ colors, onPick }: { colors: Record<string, string>; onPick: (hex: string) => void }) {
  const entries = Object.entries(colors)
  if (!entries.length) return null
  return (
    <div className="flex flex-wrap gap-1 mb-1">
      {entries.map(([name, hex]) => (
        <button
          key={name}
          title={`${name}: ${hex}`}
          onClick={() => onPick(hex)}
          className="w-4 h-4 rounded border border-edge/50 hover:scale-125 transition-transform shrink-0"
          style={{ background: hex }}
        />
      ))}
    </div>
  )
}

// ── Gradient stop editor ──────────────────────────────────────────────────────

interface GradStop { color: string; position: number }

function GradientStopEditor({
  style, patch, themeColors,
}: {
  style: ElementStyleData
  patch: (u: Partial<ElementStyleData>) => void
  themeColors: Record<string, string>
}) {
  const rawStops = style.gradient_stops
  const [stops, setStops] = useState<GradStop[]>(() =>
    rawStops && rawStops.length >= 2
      ? rawStops.map((s) => ({ color: s.color ?? "#888888", position: s.position }))
      : [{ color: "#4472C4", position: 0 }, { color: "#1a1a2e", position: 1 }]
  )
  const [angle, setAngle] = useState(style.gradient_angle ?? 90)

  const commit = (nextStops: GradStop[], nextAngle: number) => {
    patch({
      fill_type: "gradient",
      gradient_stops: nextStops.map((s) => ({ position: s.position, color: s.color })),
      gradient_angle: nextAngle,
    } as any)
  }

  const updateStop = (idx: number, fields: Partial<GradStop>) => {
    const next = stops.map((s, i) => i === idx ? { ...s, ...fields } : s)
    setStops(next)
    commit(next, angle)
  }

  const addStop = () => {
    const next = [...stops, { color: "#FFFFFF", position: 1 }]
    setStops(next)
    commit(next, angle)
  }

  const removeStop = (idx: number) => {
    if (stops.length <= 2) return
    const next = stops.filter((_, i) => i !== idx)
    setStops(next)
    commit(next, angle)
  }

  const commitAngle = (a: number) => {
    setAngle(a)
    commit(stops, a)
  }

  const previewGrad = `linear-gradient(${angle}deg, ${stops
    .slice().sort((a, b) => a.position - b.position)
    .map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(", ")})`

  return (
    <div className="mb-3">
      <ThemeSwatches colors={themeColors} onPick={(v) => updateStop(0, { color: v })} />
      <div className="space-y-1 mb-1.5">
        {stops.map((stop, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input
              type="color" value={stop.color}
              onChange={(e) => updateStop(idx, { color: e.target.value })}
              className="w-6 h-6 rounded border border-edge cursor-pointer bg-transparent p-0.5 shrink-0"
            />
            <input
              type="range" min={0} max={1} step={0.01} value={stop.position}
              onChange={(e) => updateStop(idx, { position: parseFloat(e.target.value) })}
              className="flex-1 accent-accent"
            />
            <span className="text-[10px] font-mono text-muted w-7">{Math.round(stop.position * 100)}%</span>
            {stops.length > 2 && (
              <button onClick={() => removeStop(idx)} className="text-bad/60 hover:text-bad text-xs w-4 shrink-0">✕</button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={addStop}
        className="text-[10px] text-muted hover:text-slate-200 transition-colors mb-1"
      >+ Add stop</button>
      <FieldRow label="Angle">
        <div className="flex items-center gap-1">
          <input type="range" min={0} max={360} step={5} value={angle}
            onChange={(e) => setAngle(parseInt(e.target.value))}
            onMouseUp={(e) => commitAngle(parseInt((e.target as HTMLInputElement).value))}
            className="flex-1 accent-accent" />
          <span className="text-[10px] font-mono text-muted w-8">{angle}°</span>
        </div>
      </FieldRow>
      <div className="h-4 w-full rounded border border-edge/50 mb-1" style={{ background: previewGrad }} />
    </div>
  )
}

function StyleTab({ element, docId, slideN, onCommit }: StyleTabProps) {
  const [style, setStyle] = useState<ElementStyleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [themeColors, setThemeColors] = useState<Record<string, string>>({})

  useEffect(() => {
    fetchThemeColors(docId)
      .then((r) => setThemeColors(r.theme_colors))
      .catch(() => {})
  }, [docId])

  useEffect(() => {
    setLoading(true)
    fetchElementStyle(docId, slideN, element.id)
      .then(setStyle)
      .catch(() => setStyle(null))
      .finally(() => setLoading(false))
  }, [docId, slideN, element.id])

  const patch = useCallback(async (update: Partial<ElementStyleData>) => {
    if (!style) return
    const optimistic = { ...style, ...update }
    setStyle(optimistic)
    try {
      await commitElementStyle(element.id, update)
      onCommit()
    } catch (e) {
      console.error("style update failed:", e)
    }
  }, [style, docId, slideN, element.id, onCommit])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-xs text-muted animate-pulse">Loading…</span>
      </div>
    )
  }

  if (!style) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-xs text-muted">Style data unavailable</span>
      </div>
    )
  }

  const showFill   = FILL_CAPABLE.has(element.type)
  const showImage  = IMAGE_CAPABLE.has(element.type)

  return (
    <div className="p-3 overflow-y-auto flex-1 scrollbar-thin">

      {/* Quick Styles */}
      <SectionHead title="Quick Styles" />
      <div className="flex flex-wrap gap-1 mb-3">
        {[
          { label: "Flat Blue",    style: { fill_type: "solid", fill_color: "#3B82F6", line_color: null, line_width: null, opacity: 1, shadow_on: false } },
          { label: "Flat Indigo",  style: { fill_type: "solid", fill_color: "#6366F1", line_color: null, line_width: null, opacity: 1, shadow_on: false } },
          { label: "Flat Green",   style: { fill_type: "solid", fill_color: "#22C55E", line_color: null, line_width: null, opacity: 1, shadow_on: false } },
          { label: "Flat Red",     style: { fill_type: "solid", fill_color: "#EF4444", line_color: null, line_width: null, opacity: 1, shadow_on: false } },
          { label: "Outline Blue", style: { fill_type: null, fill_color: null, line_color: "#3B82F6", line_width: 2, opacity: 1, shadow_on: false } },
          { label: "Ghost",        style: { fill_type: "solid", fill_color: "#FFFFFF", line_color: "#E2E8F0", line_width: 1, opacity: 0.08, shadow_on: false } },
          { label: "Dark",         style: { fill_type: "solid", fill_color: "#1E293B", line_color: null, line_width: null, opacity: 1, shadow_on: false } },
          { label: "Shadow Card",  style: { fill_type: "solid", fill_color: "#FFFFFF", line_color: null, line_width: null, opacity: 1, shadow_on: true, shadow_color: "#000000", shadow_blur: 12, shadow_offset_x: 0, shadow_offset_y: 4 } },
        ].map((preset) => (
          <button
            key={preset.label}
            title={preset.label}
            onClick={() => patch(preset.style)}
            className="text-[9px] px-2 py-0.5 rounded border border-edge text-muted hover:text-slate-200 hover:border-accent/40 transition-colors"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Opacity */}
      <SectionHead title="Opacity" />
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={style.opacity ?? 1}
            onChange={(e) => setStyle({ ...style, opacity: parseFloat(e.target.value) })}
            onMouseUp={(e) => patch({ opacity: parseFloat((e.target as HTMLInputElement).value) })}
            onPointerUp={(e) => patch({ opacity: parseFloat((e.target as HTMLInputElement).value) })}
            onTouchEnd={(e) => patch({ opacity: parseFloat((e.target as HTMLInputElement).value) })}
            className="flex-1 accent-accent"
          />
          <span className="text-xs font-mono text-slate-300 w-8 text-right">
            {Math.round((style.opacity ?? 1) * 100)}%
          </span>
        </div>
      </div>

      {/* Fill — shapes only */}
      {showFill && (
        <>
          <SectionHead title="Fill" />
          <FieldRow label="Type">
            <select
              value={style.fill_type ?? "none"}
              onChange={(e) => patch({ fill_type: e.target.value === "none" ? null : e.target.value })}
              className="w-full text-xs bg-base border border-edge rounded px-1.5 py-0.5 text-slate-200
                         focus:outline-none focus:border-accent"
            >
              <option value="none">None</option>
              <option value="solid">Solid</option>
              <option value="gradient">Gradient</option>
              <option value="pattern">Pattern</option>
            </select>
          </FieldRow>
          {style.fill_type === "solid" && (
            <FieldRow label="Color">
              <div>
                <ThemeSwatches colors={themeColors} onPick={(v) => patch({ fill_color: v })} />
                <ColorInput
                  value={style.fill_color ?? "#FFFFFF"}
                  onChange={(v) => patch({ fill_color: v })}
                />
              </div>
            </FieldRow>
          )}
          {style.fill_type === "gradient" && (
            <GradientStopEditor style={style} patch={patch} themeColors={themeColors} />
          )}
        </>
      )}

      {/* Line / Border */}
      <SectionHead title="Border" />
      <FieldRow label="Color">
        <div>
          <ThemeSwatches colors={themeColors} onPick={(v) => patch({ line_color: v })} />
          <ColorInput
            value={style.line_color ?? "#000000"}
            onChange={(v) => patch({ line_color: v })}
          />
        </div>
      </FieldRow>
      <FieldRow label="Width">
        <NumInput
          value={(style.line_width ?? 0).toString()}
          step={0.25} min={0}
          onChange={(v) => setStyle({ ...style, line_width: parseFloat(v) || 0 })}
          onCommit={() => patch({ line_width: style.line_width })}
          suffix="pt"
        />
      </FieldRow>
      <FieldRow label="Dash">
        <select
          value={style.line_dash ?? "solid"}
          onChange={(e) => patch({ line_dash: e.target.value })}
          className="w-full text-xs bg-base border border-edge rounded px-1.5 py-0.5 text-slate-200
                     focus:outline-none focus:border-accent"
        >
          {DASH_OPTIONS.map((d) => (
            <option key={d} value={d}>{d.replace(/_/g, " ")}</option>
          ))}
        </select>
      </FieldRow>

      {/* Shadow */}
      <SectionHead title="Shadow" />
      <FieldRow label="Enable">
        <Toggle on={style.shadow_on ?? false} onChange={(v) => patch({ shadow_on: v })} />
      </FieldRow>
      {style.shadow_on && (
        <>
          <FieldRow label="Color">
            <ColorInput
              value={style.shadow_color ?? "#000000"}
              onChange={(v) => patch({ shadow_color: v })}
            />
          </FieldRow>
          <FieldRow label="Blur">
            <NumInput
              value={(style.shadow_blur ?? 4).toString()}
              step={1} min={0}
              onChange={(v) => setStyle({ ...style, shadow_blur: parseFloat(v) })}
              onCommit={() => patch({ shadow_blur: style.shadow_blur })}
              suffix="pt"
            />
          </FieldRow>
          <FieldRow label="Offset X">
            <NumInput
              value={(style.shadow_offset_x ?? 3).toString()}
              step={1}
              onChange={(v) => setStyle({ ...style, shadow_offset_x: parseFloat(v) })}
              onCommit={() => patch({ shadow_offset_x: style.shadow_offset_x })}
              suffix="pt"
            />
          </FieldRow>
          <FieldRow label="Offset Y">
            <NumInput
              value={(style.shadow_offset_y ?? 3).toString()}
              step={1}
              onChange={(v) => setStyle({ ...style, shadow_offset_y: parseFloat(v) })}
              onCommit={() => patch({ shadow_offset_y: style.shadow_offset_y })}
              suffix="pt"
            />
          </FieldRow>
        </>
      )}

      {/* Image-specific controls: flip, crop, replace, alt */}
      {showImage && (
        <>
          <SectionHead title="Flip" />
          <FieldRow label="Horizontal">
            <Toggle
              on={!!element.flip_h}
              onChange={async (v) => {
                try { await commitElementGeometry(element.id, { flip_h: v }); onCommit() }
                catch (e) { console.error("flip_h failed:", e) }
              }}
            />
          </FieldRow>
          <FieldRow label="Vertical">
            <Toggle
              on={!!element.flip_v}
              onChange={async (v) => {
                try { await commitElementGeometry(element.id, { flip_v: v }); onCommit() }
                catch (e) { console.error("flip_v failed:", e) }
              }}
            />
          </FieldRow>

          <SectionHead title="Crop (0–100%)" />
          {(["crop_left", "crop_right", "crop_top", "crop_bottom"] as const).map((key) => {
            const label = key.replace("crop_", "").charAt(0).toUpperCase() + key.slice(5)
            return (
              <FieldRow key={key} label={label}>
                <NumInput
                  value={Math.round((style[key] ?? 0) * 100).toString()}
                  step={1} min={0} max={100}
                  onChange={(v) => setStyle({ ...style, [key]: parseFloat(v) / 100 })}
                  onCommit={() => patch({ [key]: style[key] })}
                  suffix="%"
                />
              </FieldRow>
            )
          })}
          <ImageReplaceButton docId={docId} slideN={slideN} elementId={element.id} onReplaced={onCommit} />
          <AltTextButton docId={docId} slideN={slideN} elementId={element.id} onGenerated={onCommit} />
        </>
      )}
    </div>
  )
}

function ImageReplaceButton({ docId, slideN, elementId, onReplaced }: {
  docId: string; slideN: number; elementId: string; onReplaced: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setUploading(true); setMsg(null)
    try {
      const res = await replaceImage(docId, slideN, elementId, file)
      setMsg(`Replaced (${(res.bytes / 1024).toFixed(0)} KB, ${res.format})`)
      onReplaced()
    } catch (ex) {
      setMsg(`Error: ${ex}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mt-2">
      <SectionHead title="Replace Image" />
      <label className={`flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded cursor-pointer
                        border border-edge bg-white/5 text-muted hover:text-slate-200 hover:bg-white/10
                        transition-colors ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
        {uploading ? "Uploading…" : "↑ Upload new image"}
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
      </label>
      {msg && <p className={`text-[10px] mt-1 ${msg.startsWith("Error") ? "text-bad" : "text-good"}`}>{msg}</p>}
    </div>
  )
}

function AltTextButton({ docId, slideN, elementId, onGenerated }: {
  docId: string; slideN: number; elementId: string; onGenerated: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true); setResult(null)
    try {
      const r = await generateAltText(docId, slideN, elementId)
      setResult(r.alt_text)
      onGenerated()
    } catch (ex) {
      setResult(`Error: ${ex}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={handleGenerate}
        disabled={loading}
        title="Use AI to generate descriptive alt text for this image (updates element name)"
        className="w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded border border-paper/30
                   bg-paper/10 text-paper hover:bg-paper/20 transition-colors disabled:opacity-40"
      >
        {loading ? "Generating…" : "✨ Generate Alt Text"}
      </button>
      {result && (
        <p className={`text-[10px] mt-1 ${result.startsWith("Error") ? "text-bad" : "text-paper/70"}`}>
          {result}
        </p>
      )}
    </div>
  )
}

// ── Slide properties (no element selected) ────────────────────────────────────

export const TYPE_ICON_MAP: Record<string, string> = {
  BridgeText:      "T",
  BridgeShape:     "■",
  BridgeImage:     "🖼",
  BridgeChart:     "📊",
  BridgeTable:     "▦",
  BridgeConnector: "⟶",
  BridgeFreeform:  "✏",
  BridgeGroup:     "⊞",
}

const TRANSITIONS = ["none","fade","slide","zoom","flip","push","wipe","dissolve"] as const

function SlidePropertiesPanel({ docId, slideN, onCommit }: { docId: string; slideN: number; onCommit: () => void }) {
  const [bgColor, setBgColor]     = useState("#FFFFFF")
  const [saving, setSaving]       = useState(false)
  const bgImgRef                  = useRef<HTMLInputElement>(null)
  const [bgImgUploading, setBgImgUploading] = useState(false)
  const [themeColors, setThemeColors] = useState<Record<string, string> | null>(null)
  const [stats, setStats]         = useState<DocStats | null>(null)
  const [gradStops, setGradStops] = useState<GradStop[]>([{ color: "#4472C4", position: 0 }, { color: "#1a1a2e", position: 1 }])
  const [gradAngle, setGradAngle] = useState(90)
  const [slideTransition, setSlideTransition_] = useState("none")

  useEffect(() => {
    fetchThemeColors(docId)
      .then((r) => setThemeColors(r.theme_colors))
      .catch(() => {})
    fetchDocStats(docId)
      .then(setStats)
      .catch(() => {})
    fetchSlideTransitions(docId)
      .then((r) => {
        const t = r.transitions[String(slideN)]?.transition ?? "none"
        setSlideTransition_(t)
      })
      .catch(() => {})
  }, [docId, slideN])

  const applyTransition = useCallback(async (t: string) => {
    setSlideTransition_(t)
    try { await setSlideTransition(docId, slideN, t) }
    catch (e) { console.error("transition update failed:", e) }
  }, [docId, slideN])

  const applyBg = useCallback(async (color: string | null) => {
    setSaving(true)
    try {
      await setSlideBackground(docId, slideN, color)
      onCommit()
    } catch (e) {
      console.error("bg update failed:", e)
    } finally {
      setSaving(false)
    }
  }, [docId, slideN, onCommit])

  return (
    <div className="flex-1 flex flex-col p-3">
      <p className="text-[11px] text-muted leading-relaxed mb-4">
        Configure this slide's background, gradient, transition, or theme palette.
        Click an element on the canvas to edit it directly.
      </p>

      <SectionHead title="Slide Background" />
      <FieldRow label="Color">
        <ColorInput value={bgColor} onChange={setBgColor} />
      </FieldRow>
      <button
        onClick={() => applyBg(bgColor)}
        disabled={saving}
        className="mt-2 text-xs px-3 py-1 rounded bg-accent/20 text-accent border border-accent/30
                   hover:bg-accent/30 transition-colors disabled:opacity-40"
      >
        {saving ? "Applying…" : "Set Background"}
      </button>
      <button
        onClick={() => applyBg(null)}
        disabled={saving}
        className="mt-1 text-xs px-3 py-1 rounded bg-white/5 text-muted border border-edge
                   hover:bg-white/10 transition-colors disabled:opacity-40"
      >
        Clear Background
      </button>
      <button
        onClick={async () => {
          setSaving(true)
          try { await setAllSlidesBackground(docId, bgColor); onCommit() }
          catch (e) { console.error("set all bg failed:", e) }
          finally { setSaving(false) }
        }}
        disabled={saving}
        className="mt-1 text-[10px] px-3 py-1 rounded bg-white/5 text-muted/70 border border-edge
                   hover:bg-white/10 hover:text-muted transition-colors disabled:opacity-40"
        title="Apply this background color to every slide"
      >
        Apply to All Slides
      </button>

      {/* Gradient background */}
      <SectionHead title="Gradient Background" />
      {/* Quick presets */}
      <div className="flex flex-wrap gap-1 mb-2">
        {[
          { label: "Indigo", stops: [{ color: "#312e81", position: 0 }, { color: "#1e1b4b", position: 1 }], angle: 135 },
          { label: "Sunset", stops: [{ color: "#f97316", position: 0 }, { color: "#ec4899", position: 1 }], angle: 120 },
          { label: "Ocean",  stops: [{ color: "#0ea5e9", position: 0 }, { color: "#6366f1", position: 1 }], angle: 135 },
          { label: "Forest", stops: [{ color: "#166534", position: 0 }, { color: "#14532d", position: 1 }], angle: 160 },
          { label: "Rose",   stops: [{ color: "#be185d", position: 0 }, { color: "#9d174d", position: 1 }], angle: 135 },
          { label: "Slate",  stops: [{ color: "#1e293b", position: 0 }, { color: "#0f172a", position: 1 }], angle: 180 },
          { label: "Gold",   stops: [{ color: "#ca8a04", position: 0 }, { color: "#92400e", position: 1 }], angle: 135 },
          { label: "Teal",   stops: [{ color: "#0d9488", position: 0 }, { color: "#115e59", position: 1 }], angle: 135 },
        ].map((p) => (
          <button
            key={p.label}
            title={p.label}
            onClick={() => { setGradStops(p.stops); setGradAngle(p.angle) }}
            className="text-[9px] px-1.5 py-0.5 rounded border border-edge text-muted hover:text-slate-200 transition-colors"
            style={{ background: `linear-gradient(${p.angle}deg, ${p.stops.map((s) => `${s.color} ${s.position * 100}%`).join(", ")})` }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="space-y-1 mb-2">
        {gradStops.map((stop, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input
              type="color"
              value={stop.color}
              onChange={(e) => {
                const next = [...gradStops]
                next[idx] = { ...stop, color: e.target.value }
                setGradStops(next)
              }}
              className="w-6 h-6 rounded border border-edge cursor-pointer bg-transparent p-0.5 shrink-0"
            />
            <input
              type="range" min={0} max={1} step={0.01}
              value={stop.position}
              onChange={(e) => {
                const next = [...gradStops]
                next[idx] = { ...stop, position: parseFloat(e.target.value) }
                setGradStops(next)
              }}
              className="flex-1 accent-accent"
            />
            <span className="text-[10px] font-mono text-muted w-8">{Math.round(stop.position * 100)}%</span>
            {gradStops.length > 2 && (
              <button onClick={() => setGradStops(gradStops.filter((_, i) => i !== idx))}
                className="text-bad/60 hover:text-bad text-xs w-4 shrink-0">✕</button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() => setGradStops([...gradStops, { color: "#FFFFFF", position: 1 }])}
        className="text-[10px] text-muted hover:text-slate-200 transition-colors"
      >+ Add stop</button>
      <FieldRow label="Angle">
        <div className="flex items-center gap-1">
          <input type="range" min={0} max={360} step={5} value={gradAngle}
            onChange={(e) => setGradAngle(parseInt(e.target.value))}
            className="flex-1 accent-accent" />
          <span className="text-[10px] font-mono text-muted w-8">{gradAngle}°</span>
        </div>
      </FieldRow>
      {/* preview swatch */}
      <div
        className="h-5 w-full rounded mb-2 border border-edge/50"
        style={{
          background: `linear-gradient(${gradAngle}deg, ${gradStops
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((s) => `${s.color} ${Math.round(s.position * 100)}%`)
            .join(", ")})`,
        }}
      />
      <button
        onClick={async () => {
          setSaving(true)
          try {
            await setGradientBackground(docId, slideN, gradStops, gradAngle)
            onCommit()
          } catch (e) { console.error("gradient failed:", e) }
          finally { setSaving(false) }
        }}
        disabled={saving}
        className="text-xs px-3 py-1 rounded bg-accent/20 text-accent border border-accent/30
                   hover:bg-accent/30 transition-colors disabled:opacity-40"
      >
        {saving ? "Applying…" : "Apply Gradient"}
      </button>

      {/* Background image */}
      <SectionHead title="Background Image" />
      <input
        ref={bgImgRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          setBgImgUploading(true)
          try {
            await setSlideBackgroundImage(docId, slideN, file)
            onCommit()
          } catch (err) { console.error("bg image upload failed:", err) }
          finally { setBgImgUploading(false); e.target.value = "" }
        }}
      />
      <button
        onClick={() => bgImgRef.current?.click()}
        disabled={bgImgUploading}
        className="text-xs px-3 py-1 rounded bg-white/5 text-muted border border-edge
                   hover:bg-white/10 hover:text-slate-200 transition-colors disabled:opacity-40"
      >
        {bgImgUploading ? "Uploading…" : "🖼 Upload Background Image"}
      </button>
      <p className="text-[10px] text-muted/60 mt-1">Fills slide; becomes bottom-most element</p>

      {/* Slide transition */}
      <SectionHead title="Slide Transition" />
      <div className="flex flex-wrap gap-1 mt-1">
        {TRANSITIONS.map((t) => {
          const ICONS: Record<string, string> = {
            none: "—", fade: "◌", slide: "→", zoom: "⊕", flip: "⟲", push: "⇒", wipe: "▶", dissolve: "∿",
          }
          return (
            <button
              key={t}
              onClick={() => applyTransition(t)}
              title={`${t} transition`}
              className={`text-[10px] px-1.5 py-0.5 rounded border capitalize transition-colors flex items-center gap-1 ${
                slideTransition === t
                  ? "bg-paper/30 text-paper border-paper/40"
                  : "bg-white/5 text-muted border-edge hover:bg-white/10 hover:text-slate-300"
              }`}
            >
              <span className="text-[9px] opacity-70">{ICONS[t] ?? "·"}</span>
              {t}
            </button>
          )
        })}
      </div>

      {themeColors && Object.keys(themeColors).length > 0 && (
        <>
          <SectionHead title="Theme Colors" />
          <div className="flex flex-wrap gap-1.5 mt-1">
            {Object.entries(themeColors).map(([name, hex]) => (
              <button
                key={name}
                title={`${name}: ${hex}`}
                onClick={() => setBgColor(hex)}
                className="w-6 h-6 rounded border border-edge/50 hover:scale-110 transition-transform shrink-0"
                style={{ background: hex }}
              />
            ))}
          </div>
          <p className="text-[10px] text-muted/60 mt-1">Click to use as background</p>
        </>
      )}

      {/* Presentation stats moved to a popover off the slide-strip header — */}
      {/* keeps the inspector focused on what's editable here. */}
      {stats && null}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  element: StudioElement | null
  elements?: StudioElement[]
  multiSelectIds?: Set<string>
  slideN: number
  slideWidthIn: number
  slideHeightIn: number
  docId: string
  onTextCommit: () => void
  onEditConnect?: (elementId: string) => void
  onSelectElement?: (el: StudioElement) => void
  onDeleteElement?: (id: string) => void
  onToggleLock?: (id: string, locked: boolean) => void
  onToggleHidden?: (id: string, hidden: boolean) => void
  collapsed?: boolean
  onToggleCollapsed?: (collapsed: boolean) => void
}

type Tab = "position" | "style" | "text" | "chart" | "table" | "connector"
type NoSelTab = "slide" | "elements"

// ── Bridge binding status row (top of inspector) ─────────────────────────────

import { fetchElementConnect, type ConnectScript } from "../../lib/studioApi"

function BindingStatusRow({
  docId, slideN, element, onEditConnect,
}: {
  docId: string
  slideN: number
  element: StudioElement
  onEditConnect?: (elementId: string) => void
}) {
  const [connect, setConnect] = useState<ConnectScript | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchElementConnect(docId, slideN, element.id)
      .then((c) => { if (!cancelled) setConnect(c) })
      .catch(() => { if (!cancelled) setConnect(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
  }, [docId, slideN, element.id])

  const hasScript = !!(connect?.script && connect.script.trim().length > 0)
  const lastRun   = connect?.updated_at && connect.updated_at > 0
    ? new Date(connect.updated_at * 1000)
    : null

  return (
    <div className="border border-edge/60 rounded-md bg-base/30 px-2 py-1.5 mb-2">
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <div className="flex items-center gap-1.5 uppercase tracking-[0.16em] text-muted/70">
          <span className={`w-1.5 h-1.5 rounded-full ${hasScript ? "bg-emerald-400" : "bg-slate-600"}`} />
          Binding
        </div>
        <span className="text-[10px] text-muted/60 font-mono">
          {loading ? "…" : hasScript ? "active" : "none"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-slate-400 truncate">
          {hasScript
            ? lastRun ? `Saved ${lastRun.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "Connect attached"
            : "No Python connect attached"}
        </div>
        <button
          onClick={() => onEditConnect?.(element.id)}
          disabled={!onEditConnect}
          className="text-[10px] text-slate-200 hover:text-white px-1.5 py-0.5 rounded border border-edge hover:bg-white/8 disabled:opacity-40"
        >
          {hasScript ? "Edit Connect" : "Add Connect"}
        </button>
      </div>
    </div>
  )
}

export default function StudioPropertiesPanel({
  element, elements, multiSelectIds, slideN, slideWidthIn: _slideWidthIn, slideHeightIn: _slideHeightIn, docId, onTextCommit, onSelectElement,
  onDeleteElement, onToggleLock, onToggleHidden, onEditConnect,
  collapsed = false, onToggleCollapsed,
}: Props) {
  // Collapsed rail: just a 36px column with a chevron to expand. Mirrors
  // the StudioAgent collapsed pattern so the right side feels consistent.
  if (collapsed) {
    const hasSel = !!element || (multiSelectIds && multiSelectIds.size > 1)
    return (
      <div className="w-9 shrink-0 border-l border-edge bg-surface flex flex-col items-center py-2 gap-2 select-none">
        <button
          onClick={() => onToggleCollapsed?.(false)}
          title="Show properties"
          className={`w-7 h-7 rounded-md border flex items-center justify-center text-base ${
            hasSel
              ? "bg-accent/20 text-accent border-accent/40 hover:bg-accent/30"
              : "bg-white/5 text-muted border-edge hover:bg-white/10"
          }`}
        >
          ◧
        </button>
        <div className="text-[8px] tracking-[0.18em] uppercase text-muted/70 [writing-mode:vertical-rl] rotate-180 mt-1">
          Properties
        </div>
      </div>
    )
  }
  const [tab, setTab] = useState<Tab>("position")
  const [noSelTab, setNoSelTab] = useState<NoSelTab>("slide")
  const [elemCtxMenu, setElemCtxMenu] = useState<{ x: number; y: number; el: StudioElement } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (renamingId) renameInputRef.current?.focus() }, [renamingId])

  const commitRename = useCallback(async (el: StudioElement) => {
    const trimmed = renameVal.trim()
    if (trimmed && trimmed !== el.name) {
      try { await commitElementGeometry(el.id, { name: trimmed }) }
      catch (e) { console.error("rename failed:", e) }
    }
    setRenamingId(null)
  }, [renameVal, docId, slideN])

  // reset tab when element changes — typed editors default to their own tab
  useEffect(() => {
    if      (element?.type === "BridgeChart")     setTab("chart")
    else if (element?.type === "BridgeTable")     setTab("table")
    else if (element?.type === "BridgeConnector") setTab("connector")
    else                                          setTab("position")
  }, [element?.id, element?.type])

  const showTextTab      = element ? TEXT_CAPABLE.has(element.type)         : false
  const showStyleTab     = element ? STYLE_CAPABLE.has(element.type)        : false
  const showChartTab     = element ? element.type === "BridgeChart"         : false
  const showTableTab     = element ? element.type === "BridgeTable"         : false
  const showConnectorTab = element ? element.type === "BridgeConnector"     : false

  const color = element ? (TYPE_COLOR[element.type] ?? "#6366F1") : "#6366F1"

  // ── multi-select bulk style ─────────────────────────────────────────────────
  const [bulkFill, setBulkFill] = useState("#4472C4")
  const [bulkLine, setBulkLine] = useState("#000000")
  const [bulkOpacity, setBulkOpacity] = useState("1.0")
  const [bulkApplying, setBulkApplying] = useState(false)
  const [bulkApplyFields, setBulkApplyFields] = useState({ fill: false, line: false, opacity: false })

  const handleBulkApply = useCallback(async () => {
    if (!multiSelectIds || multiSelectIds.size < 2) return
    const style: Record<string, unknown> = {}
    if (bulkApplyFields.fill) style.fill_color = bulkFill
    if (bulkApplyFields.line) style.line_color = bulkLine
    if (bulkApplyFields.opacity) style.opacity = parseFloat(bulkOpacity) || 1.0
    if (!Object.keys(style).length) return
    setBulkApplying(true)
    try {
      await bulkUpdateStyle(docId, slideN, [...multiSelectIds], style)
      onTextCommit()
    } catch (e) { console.error("bulk style failed:", e) }
    finally { setBulkApplying(false) }
  }, [multiSelectIds, bulkFill, bulkLine, bulkOpacity, bulkApplyFields, docId, slideN, onTextCommit])

  return (
    <div className="w-64 shrink-0 border-l border-edge bg-surface flex flex-col">
      {/* ── header ──────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-edge">
        <div className="px-3 pt-3 relative">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[9px] uppercase tracking-[0.18em] text-muted/70">Properties</div>
            {onToggleCollapsed && (
              <button
                onClick={() => onToggleCollapsed(true)}
                title="Hide properties"
                className="text-muted hover:text-paper text-base leading-none px-1"
              >◨</button>
            )}
          </div>
          {element ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
                <span className="text-sm font-semibold text-slate-200 truncate">{element.name}</span>
              </div>
              <div className="text-[10px] text-muted/80 mb-2 font-mono">{element.type}</div>
              <BindingStatusRow
                docId={docId}
                slideN={slideN}
                element={element}
                onEditConnect={onEditConnect}
              />
            </>
          ) : multiSelectIds && multiSelectIds.size > 1 ? (
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-sm shrink-0 bg-slate-400" />
              <span className="text-sm font-semibold text-slate-200">{multiSelectIds.size} elements selected</span>
            </div>
          ) : (
            <div className="text-xs text-muted mb-2">No element selected</div>
          )}
        </div>

        {/* tabs */}
        <div className="flex px-2 gap-0.5">
          {multiSelectIds && multiSelectIds.size > 1 && !element ? null : !element ? (
            (["slide", "elements"] as NoSelTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setNoSelTab(t)}
                className={[
                  "px-2.5 py-1 text-[11px] rounded-t transition-colors capitalize",
                  noSelTab === t
                    ? "bg-base text-slate-200 border-t border-l border-r border-edge"
                    : "text-muted hover:text-slate-300",
                ].join(" ")}
              >
                {t === "elements" ? `Elements${elements ? ` (${elements.length})` : ""}` : t}
              </button>
            ))
          ) : (
            (["chart", "table", "connector", "position", "style", "text"] as Tab[]).map((t) => {
              if (t === "text"      && !showTextTab)      return null
              if (t === "style"     && !showStyleTab)     return null
              if (t === "chart"     && !showChartTab)     return null
              if (t === "table"     && !showTableTab)     return null
              if (t === "connector" && !showConnectorTab) return null
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={[
                    "px-2.5 py-1 text-[11px] rounded-t transition-colors capitalize",
                    tab === t
                      ? "bg-base text-slate-200 border-t border-l border-r border-edge"
                      : "text-muted hover:text-slate-300",
                  ].join(" ")}
                >
                  {t}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── multi-select bulk style panel ───────────────────── */}
      {!element && multiSelectIds && multiSelectIds.size > 1 && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
          <div className="text-[10px] text-muted uppercase tracking-widest">Apply to all selected</div>

          {/* fill color */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={bulkApplyFields.fill}
              onChange={(e) => setBulkApplyFields((f) => ({ ...f, fill: e.target.checked }))}
              className="accent-indigo-500 w-3 h-3" />
            <span className="text-[11px] text-muted w-16">Fill Color</span>
            <input type="color" value={bulkFill} onChange={(e) => setBulkFill(e.target.value)}
              className="w-7 h-7 rounded border border-edge bg-transparent cursor-pointer" />
            <span className="text-[10px] font-mono text-muted/70">{bulkFill}</span>
          </label>

          {/* line color */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={bulkApplyFields.line}
              onChange={(e) => setBulkApplyFields((f) => ({ ...f, line: e.target.checked }))}
              className="accent-indigo-500 w-3 h-3" />
            <span className="text-[11px] text-muted w-16">Line Color</span>
            <input type="color" value={bulkLine} onChange={(e) => setBulkLine(e.target.value)}
              className="w-7 h-7 rounded border border-edge bg-transparent cursor-pointer" />
            <span className="text-[10px] font-mono text-muted/70">{bulkLine}</span>
          </label>

          {/* opacity */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={bulkApplyFields.opacity}
              onChange={(e) => setBulkApplyFields((f) => ({ ...f, opacity: e.target.checked }))}
              className="accent-indigo-500 w-3 h-3" />
            <span className="text-[11px] text-muted w-16">Opacity</span>
            <input type="range" min={0} max={1} step={0.05} value={bulkOpacity}
              onChange={(e) => setBulkOpacity(e.target.value)}
              className="flex-1 accent-indigo-500" />
            <span className="text-[10px] font-mono text-muted/70 w-8">{Math.round(parseFloat(bulkOpacity) * 100)}%</span>
          </label>

          <button
            onClick={handleBulkApply}
            disabled={bulkApplying || !Object.values(bulkApplyFields).some(Boolean)}
            className="w-full text-xs py-1.5 rounded bg-paper/20 text-paper
                       border border-paper/30 hover:bg-paper/30 transition-colors
                       disabled:opacity-40"
          >
            {bulkApplying ? "Applying…" : `Apply to ${multiSelectIds.size} elements`}
          </button>
        </div>
      )}

      {/* ── tab content ─────────────────────────────────────── */}
      {(!element && !(multiSelectIds && multiSelectIds.size > 1)) ? (
        noSelTab === "elements" ? (
          <div className="flex-1 overflow-y-auto p-2 scrollbar-thin relative">
            {!elements || elements.length === 0 ? (
              <p className="text-xs text-muted p-2">No elements on this slide.</p>
            ) : (
              [...elements].sort((a, b) => b.z_index - a.z_index).map((el) => (
                <div
                  key={el.id}
                  onContextMenu={(e) => { e.preventDefault(); setElemCtxMenu({ x: e.clientX, y: e.clientY, el }) }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left
                             hover:bg-white/5 transition-colors group cursor-pointer"
                  onClick={() => { if (renamingId !== el.id) onSelectElement?.(el) }}
                >
                  <div
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ background: TYPE_COLOR[el.type] ?? "#6366F1" }}
                  />
                  {renamingId === el.id ? (
                    <input
                      ref={renameInputRef}
                      className="flex-1 min-w-0 text-xs bg-black/40 border border-accent/60 rounded px-1 py-0 text-slate-200 focus:outline-none"
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onBlur={() => commitRename(el)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitRename(el) }
                        if (e.key === "Escape") setRenamingId(null)
                        e.stopPropagation()
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="text-xs text-slate-300 truncate flex-1 min-w-0"
                      onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(el.id); setRenameVal(el.name) }}
                    >
                      {el.name}
                    </span>
                  )}
                  {el.locked && <span className="text-[10px] text-muted shrink-0">🔒</span>}
                  {el.hidden && <span className="text-[10px] text-muted shrink-0">👁</span>}
                  <span className="text-[10px] text-muted shrink-0 opacity-0 group-hover:opacity-100">z{el.z_index}</span>
                </div>
              ))
            )}

            {/* element context menu */}
            {elemCtxMenu && (
              <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setElemCtxMenu(null)} />
                <div
                  className="fixed z-[9999] bg-surface border border-edge rounded-lg shadow-2xl py-1 w-44 text-xs"
                  style={{ left: elemCtxMenu.x, top: elemCtxMenu.y }}
                >
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-200"
                    onClick={() => { onSelectElement?.(elemCtxMenu.el); setElemCtxMenu(null) }}
                  >
                    Select
                  </button>
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-300"
                    onClick={() => { onToggleLock?.(elemCtxMenu.el.id, !elemCtxMenu.el.locked); setElemCtxMenu(null) }}
                  >
                    {elemCtxMenu.el.locked ? "🔒 Unlock" : "🔓 Lock"}
                  </button>
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-300"
                    onClick={() => { onToggleHidden?.(elemCtxMenu.el.id, !elemCtxMenu.el.hidden); setElemCtxMenu(null) }}
                  >
                    {elemCtxMenu.el.hidden ? "👁 Show" : "🙈 Hide"}
                  </button>
                  <a
                    href={elementPngUrl(docId, slideN, elemCtxMenu.el.id)}
                    download={`element-${elemCtxMenu.el.id.slice(0, 8)}.png`}
                    onClick={() => setElemCtxMenu(null)}
                    className="w-full text-left px-3 py-1.5 hover:bg-white/10 text-slate-300 flex items-center gap-1.5 no-underline"
                  >
                    ↓ Download as PNG
                  </a>
                  <div className="border-t border-edge my-1" />
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-red-900/30 text-bad"
                    onClick={() => { onDeleteElement?.(elemCtxMenu.el.id); setElemCtxMenu(null) }}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <SlidePropertiesPanel docId={docId} slideN={slideN} onCommit={onTextCommit} />
        )
      ) : tab === "chart" && element && element.type === "BridgeChart" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <ChartEditorPanel
            docId={docId}
            slideN={slideN}
            elementId={element.id}
            onCommit={onTextCommit}
          />
        </div>
      ) : tab === "table" && element && element.type === "BridgeTable" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <TableEditorPanel
            docId={docId}
            slideN={slideN}
            elementId={element.id}
            onCommit={onTextCommit}
          />
        </div>
      ) : tab === "connector" && element && element.type === "BridgeConnector" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <ConnectorEditorPanel
            docId={docId}
            slideN={slideN}
            elementId={element.id}
            onCommit={onTextCommit}
          />
        </div>
      ) : tab === "position" && element ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <PositionTab
            element={element}
            docId={docId}
            slideN={slideN}
            onCommit={onTextCommit}
          />
        </div>
      ) : tab === "style" && element ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <StyleTab
            element={element}
            docId={docId}
            slideN={slideN}
            onCommit={onTextCommit}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <StudioTextPanel
            element={element}
            docId={docId}
            slideN={slideN}
            onCommit={onTextCommit}
          />
        </div>
      )}
    </div>
  )
}
