import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import TextBubbleMenu from "../TextBubbleMenu"
import { useEditor, EditorContent, generateHTML } from "@tiptap/react"
import Collaboration from "@tiptap/extension-collaboration"
import type { ElementStyleData, ParagraphsTextContent } from "../../../lib/studioTypes"
import { updateElementText } from "../../../lib/studioApi"
import { useStudioTextStylePayload } from "../../../lib/studio/payloadHooks"
import { studioStore, useEditingElementId } from "../../../lib/studio/store"
import { paragraphsToTiptap, tiptapToParagraphs } from "../../../lib/bridge/tiptapAdapter"
import { bridgeExtensions } from "../../../lib/bridge/extensions"
import { setActiveTiptapEditor } from "../../../lib/bridge/activeEditor"
import { getCollabContext } from "../../../lib/collab/collabContext"
import { hydrateElementText } from "../../../lib/collab/bridgeYjsSync"
import { getAwareness, setLocalEditing } from "../../../lib/collab/awareness"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror"
import { consumePendingAutoEdit } from "../../../lib/pendingAutoEdit"

// ── SVG path generation ───────────────────────────────────────────────────────

// Parse an OOXML guide formula like "val 16200000" → 16200000
function adjVal(adj: Record<string, string | number> | undefined, name: string, fallback: number): number {
  const v = adj?.[name]
  if (v == null) return fallback
  if (typeof v === "number") return v
  const m = String(v).match(/val\s+(-?\d+)/)
  return m ? parseInt(m[1]) : fallback
}

/**
 * Build the `d` attribute (or element props) for an SVG shape.
 * W and H are the viewport dimensions (always 100×100 in the normalized viewBox).
 */
function shapeProps(
  preset: string | null | undefined,
  adj?: Record<string, string | number>,
): React.SVGProps<SVGElement> & { tag: "rect" | "ellipse" | "path" | "polygon" } {
  const p = (preset ?? "rect").toLowerCase()
  switch (p) {
    case "rect":
      return { tag: "rect", x: 0, y: 0, width: 100, height: 100 }

    case "roundrect": {
      // OOXML adj is "adj" = guide in /100000 of the shorter side.
      // Default corner radius in PPTX is 16667/100000 ≈ 16.7% → ~8.33 on 50-unit side.
      const rawAdj = adj?.adj ?? "16667"
      const f = parseInt(String(rawAdj), 10) / 100000
      const rx = Math.min(50 * f, 50) * 100 / 100 // scale to 100-unit space, capped at 50
      return { tag: "rect", x: 0, y: 0, width: 100, height: 100, rx, ry: rx }
    }

    case "ellipse":
    case "oval":
      return { tag: "ellipse", cx: 50, cy: 50, rx: 50, ry: 50 }

    case "diamond":
      return { tag: "polygon", points: "50,0 100,50 50,100 0,50" }

    case "triangle":
      return { tag: "polygon", points: "50,0 100,100 0,100" }

    case "rtriangle":
      return { tag: "polygon", points: "0,0 100,100 0,100" }

    case "parallelogram": {
      const slant = 20
      return { tag: "polygon", points: `${slant},0 100,0 ${100 - slant},100 0,100` }
    }

    case "trapezoid": {
      const cut = 20
      return { tag: "polygon", points: `${cut},0 ${100 - cut},0 100,100 0,100` }
    }

    case "pentagon":
      return { tag: "polygon", points: regularPolygon(5, 50, 50, 50, -Math.PI / 2) }

    case "hexagon":
      return { tag: "polygon", points: regularPolygon(6, 50, 50, 50, 0) }

    case "octagon":
      return { tag: "polygon", points: regularPolygon(8, 50, 50, 50, -Math.PI / 8) }

    case "star4":
      return { tag: "polygon", points: starPolygon(4, 50, 50, 50, 20, 0) }
    case "star5":
      return { tag: "polygon", points: starPolygon(5, 50, 50, 50, 20, -Math.PI / 2) }
    case "star6":
      return { tag: "polygon", points: starPolygon(6, 50, 50, 50, 30, 0) }
    case "star8":
      return { tag: "polygon", points: starPolygon(8, 50, 50, 50, 25, 0) }

    case "heart":
      return { tag: "path", d: "M50,85 C20,65 5,45 5,30 C5,15 15,5 30,5 C38,5 46,9 50,15 C54,9 62,5 70,5 C85,5 95,15 95,30 C95,45 80,65 50,85 Z" }

    case "plus": {
      const aw = adjVal(adj, "adj", 25000) / 100000 * 100
      const a = Math.max(5, Math.min(45, aw))
      return {
        tag: "polygon",
        points: `${a},0 ${100-a},0 ${100-a},${a} 100,${a} 100,${100-a} ${100-a},${100-a} ${100-a},100 ${a},100 ${a},${100-a} 0,${100-a} 0,${a} ${a},${a}`,
      }
    }

    case "downarrow": {
      const headH = adjVal(adj, "adj1", 50000) / 100000 * 100
      const shaftW = adjVal(adj, "adj2", 50000) / 100000 * 100
      const hh = Math.max(10, Math.min(90, headH))
      const sw = Math.max(10, Math.min(90, shaftW))
      const sx = (100 - sw) / 2
      const shaftY = 100 - hh
      return {
        tag: "polygon",
        points: `${sx},0 ${sx+sw},0 ${sx+sw},${shaftY} 100,${shaftY} 50,100 0,${shaftY} ${sx},${shaftY}`,
      }
    }

    case "uparrow": {
      const headH = adjVal(adj, "adj1", 50000) / 100000 * 100
      const shaftW = adjVal(adj, "adj2", 50000) / 100000 * 100
      const hh = Math.max(10, Math.min(90, headH))
      const sw = Math.max(10, Math.min(90, shaftW))
      const sx = (100 - sw) / 2
      return {
        tag: "polygon",
        points: `50,0 100,${hh} ${sx+sw},${hh} ${sx+sw},100 ${sx},100 ${sx},${hh} 0,${hh}`,
      }
    }

    case "updownarrow": {
      const headH = adjVal(adj, "adj1", 25000) / 100000 * 100
      const shaftW = adjVal(adj, "adj2", 50000) / 100000 * 100
      const hh = Math.max(10, Math.min(40, headH))
      const sw = Math.max(10, Math.min(90, shaftW))
      const sx = (100 - sw) / 2
      return {
        tag: "polygon",
        points: `50,0 100,${hh} ${sx+sw},${hh} ${sx+sw},${100-hh} 100,${100-hh} 50,100 0,${100-hh} ${sx},${100-hh} ${sx},${hh} 0,${hh}`,
      }
    }

    case "rightarrow": {
      const headW = adjVal(adj, "adj1", 50000) / 100000 * 100
      const shaftH = adjVal(adj, "adj2", 50000) / 100000 * 100
      const hw = Math.max(10, Math.min(90, headW))
      const sh = Math.max(10, Math.min(90, shaftH))
      const sy = (100 - sh) / 2
      const arrowX = 100 - hw
      return {
        tag: "polygon",
        points: `0,${sy} ${arrowX},${sy} ${arrowX},0 100,50 ${arrowX},100 ${arrowX},${sy+sh} 0,${sy+sh}`,
      }
    }

    case "leftarrow": {
      const headW = adjVal(adj, "adj1", 50000) / 100000 * 100
      const shaftH = adjVal(adj, "adj2", 50000) / 100000 * 100
      const hw = Math.max(10, Math.min(90, headW))
      const sh = Math.max(10, Math.min(90, shaftH))
      const sy = (100 - sh) / 2
      return {
        tag: "polygon",
        points: `0,50 ${hw},0 ${hw},${sy} 100,${sy} 100,${sy+sh} ${hw},${sy+sh} ${hw},100`,
      }
    }

    case "callout1":
    case "wedgecalloutrect":
    case "wedgecallout": {
      return { tag: "path", d: "M 0,0 L 100,0 L 100,75 L 25,75 L 0,100 L 15,75 L 0,75 Z" }
    }

    case "rightbracket": {
      return { tag: "path", d: "M 25,0 L 90,0 L 90,100 L 25,100" }
    }

    case "leftbracket": {
      return { tag: "path", d: "M 75,0 L 10,0 L 10,100 L 75,100" }
    }

    case "arc":
    case "pie": {
      // PowerPoint stores adj1=startAngle, adj2=endAngle (both in 60000ths of degree)
      // despite OOXML spec naming adj2 "swAng" — empirically confirmed from PPTX XML
      const stAng  = adjVal(adj, "adj1", 16200000) / 60000
      const endAng = adjVal(adj, "adj2", 21600000) / 60000
      let swAng = endAng - stAng
      if (swAng <= 0) swAng += 360  // wrap-around past 0°/360°
      const a1 = stAng
      const a2 = a1 + swAng
      const r1 = (a1 * Math.PI) / 180
      const r2 = (a2 * Math.PI) / 180
      const sx = (50 + 50 * Math.cos(r1)).toFixed(3)
      const sy = (50 + 50 * Math.sin(r1)).toFixed(3)
      const ex = (50 + 50 * Math.cos(r2)).toFixed(3)
      const ey = (50 + 50 * Math.sin(r2)).toFixed(3)
      const largeArc = swAng > 180 ? 1 : 0
      if (p === "pie") {
        return { tag: "path", d: `M 50,50 L ${sx},${sy} A 50,50 0 ${largeArc},1 ${ex},${ey} Z` }
      }
      return { tag: "path", d: `M ${sx},${sy} A 50,50 0 ${largeArc},1 ${ex},${ey}` }
    }

    case "can": {
      // 3D cylinder. adj = ellipse cap height as fraction of total height (default 25000/100000 = 25%).
      const capH = adjVal(adj, "adj", 25000) / 100000 * 100
      const c = Math.max(3, Math.min(45, capH / 2))  // semi-height of top/bottom ellipse in viewBox units
      // SVG arc: A rx,ry rot large-arc sweep endX,endY
      // upper half of top ellipse: sweep=0 (CCW in y-down = goes upward)
      // lower half of top ellipse: sweep=1 (CW = goes downward, the inner depth line)
      // bottom ellipse lower half: sweep=1 (visible base)
      const d = [
        `M 0,${c}`,
        `A 50,${c} 0 0 0 100,${c}`,           // upper half of top cap
        `L 100,${100 - c}`,
        `A 50,${c} 0 0 1 0,${100 - c}`,       // lower half of bottom cap
        `Z`,
        `M 0,${c} A 50,${c} 0 0 1 100,${c}`,  // inner depth line (lower half of top cap)
      ].join(" ")
      return { tag: "path", d }
    }

    default:
      return { tag: "rect", x: 0, y: 0, width: 100, height: 100 }
  }
}

function regularPolygon(n: number, cx: number, cy: number, r: number, startAngle: number): string {
  const pts: string[] = []
  for (let i = 0; i < n; i++) {
    const a = startAngle + (2 * Math.PI * i) / n
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`)
  }
  return pts.join(" ")
}

function starPolygon(n: number, cx: number, cy: number, outerR: number, innerR: number, startAngle: number): string {
  const pts: string[] = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const a = startAngle + (Math.PI * i) / n
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`)
  }
  return pts.join(" ")
}

// ── SVG dash style ────────────────────────────────────────────────────────────

function dashArray(dash: string | null | undefined, strokeW: string): string | undefined {
  const w = parseFloat(strokeW) || 1
  switch (dash) {
    case "dash":           return `${w * 4} ${w * 2}`
    case "dot":            return `${w} ${w * 2}`
    case "dash_dot":       return `${w * 4} ${w * 2} ${w} ${w * 2}`
    case "lg_dash":        return `${w * 8} ${w * 3}`
    case "lg_dash_dot":    return `${w * 8} ${w * 2} ${w} ${w * 2}`
    case "lg_dash_dot_dot":return `${w * 8} ${w * 2} ${w} ${w * 2} ${w} ${w * 2}`
    case "sys_dash":       return `${w * 3} ${w * 2}`
    case "sys_dot":        return `${w * 2} ${w * 2}`
    default:               return undefined
  }
}

// ── SVG background shape ──────────────────────────────────────────────────────

interface ShapeSvgProps {
  id?:            string
  preset:         string | null | undefined
  adj?:           Record<string, string | number>
  style:          ElementStyleData | null
  flipH:          boolean
  flipV:          boolean
  elementWidthIn?: number
}

function ShapeSvg({ id, preset, adj, style, flipH, flipV, elementWidthIn }: ShapeSvgProps) {
  const gradId = id ? `grad-${id}` : "grad-shape"

  // Fill (fill_type is lowercase from API: "solid", "gradient", "none")
  const fillTypeLower = style?.fill_type?.toLowerCase()
  const isGradient = fillTypeLower === "gradient" && style?.gradient_stops && style.gradient_stops.length >= 2
  const noFill = fillTypeLower === "none"
    || fillTypeLower === "nofill"
    || (fillTypeLower === "background" && !style?.fill_color)
    || (style?.fill_type == null && !style?.fill_color)
  const fillAttr = isGradient
    ? `url(#${gradId})`
    : noFill
    ? "none"
    : (style?.fill_color ?? "#E2E8F0")

  // Stroke
  const lineVisible = style?.line_visible !== false
  const stroke  = (lineVisible && style?.line_color) ? style.line_color : "none"
  const strokeW = (lineVisible && style?.line_width != null)
    ? (style.line_width / 72 * 100 / (elementWidthIn ?? 13.333)).toFixed(3)
    : "0"
  const strokeDash = dashArray(style?.line_dash, strokeW)

  const opacity = style?.opacity ?? 1

  // Shadow via CSS filter on the SVG element
  const shadowFilter = style?.shadow_on
    ? `drop-shadow(${(style.shadow_offset_x ?? 0).toFixed(1)}pt ${(style.shadow_offset_y ?? 0).toFixed(1)}pt ${(style.shadow_blur ?? 0).toFixed(1)}pt ${style.shadow_color ?? "#000000"})`
    : undefined

  const transform = (flipH || flipV)
    ? `scale(${flipH ? -1 : 1},${flipV ? -1 : 1}) translate(${flipH ? -100 : 0},${flipV ? -100 : 0})`
    : undefined

  // Gradient defs
  const gradDef = isGradient && style?.gradient_stops ? (() => {
    const angle = style.gradient_angle ?? 0
    const rad = (angle * Math.PI) / 180
    const x1 = (50 - 50 * Math.cos(rad)).toFixed(2)
    const y1 = (50 - 50 * Math.sin(rad)).toFixed(2)
    const x2 = (50 + 50 * Math.cos(rad)).toFixed(2)
    const y2 = (50 + 50 * Math.sin(rad)).toFixed(2)
    return (
      <defs>
        <linearGradient id={gradId} x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`} gradientUnits="userSpaceOnUse">
          {style.gradient_stops.map((s, i) => (
            s.color ? <stop key={i} offset={`${(s.position * 100).toFixed(1)}%`} stopColor={s.color} /> : null
          ))}
        </linearGradient>
      </defs>
    )
  })() : null

  const shapeAttrs = { fill: fillAttr, stroke, strokeWidth: strokeW, ...(strokeDash ? { strokeDasharray: strokeDash } : {}) }
  const props = shapeProps(preset, adj)
  const { tag, ...svgAttrs } = props
  const shapeEl = tag === "rect"
    ? <rect {...(svgAttrs as React.SVGProps<SVGRectElement>)} {...shapeAttrs} />
    : tag === "ellipse"
    ? <ellipse {...(svgAttrs as React.SVGProps<SVGEllipseElement>)} {...shapeAttrs} />
    : tag === "polygon"
    ? <polygon {...(svgAttrs as React.SVGProps<SVGPolygonElement>)} {...shapeAttrs} />
    : <path {...(svgAttrs as React.SVGProps<SVGPathElement>)} {...shapeAttrs} />

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{
        width: "100%", height: "100%", display: "block", overflow: "visible",
        ...(shadowFilter ? { filter: shadowFilter } : {}),
      }}
      opacity={opacity}
    >
      {gradDef}
      {transform ? <g transform={transform}>{shapeEl}</g> : shapeEl}
    </svg>
  )
}

// ── Main renderer ─────────────────────────────────────────────────────────────

function BridgeShapeRendererImpl({
  element, docId, slideN, renderKey, selected,
}: NativeRendererProps) {
  const [content, setContent] = useState<ParagraphsTextContent | null>(null)
  const [style, setStyle] = useState<ElementStyleData | null>(null)
  const [editing, setEditing] = useState(false)
  const payload = useStudioTextStylePayload(docId, slideN, element.id, renderKey)

  const preset = element.geometry_preset

  useEffect(() => {
    if (payload.text) setContent(payload.text.kind === "paragraphs" ? payload.text : null)
  }, [payload.text])

  useEffect(() => {
    if (payload.style) setStyle(payload.style)
  }, [payload.style])

  const hasBeenSelectedRef = useRef(false)
  useEffect(() => {
    if (selected) hasBeenSelectedRef.current = true
    if (!selected && editing && hasBeenSelectedRef.current) setEditing(false)
  }, [selected, editing])

  useEffect(() => {
    if (consumePendingAutoEdit(element.id)) setEditing(true)
  }, [element.id])

  // Listen for the global "enter edit mode" signal set by ElementOverlay's
  // onDoubleClick — atomic, race-free activation.
  const editingElementId = useEditingElementId()
  useEffect(() => {
    if (editingElementId === element.id && !editing) {
      setEditing(true)
      studioStore.setEditingElement(null)
    }
  }, [editingElementId, element.id, editing])

  useEffect(() => {
    const collab = getCollabContext()
    if (!collab?.enabled || !collab.room) return
    setLocalEditing(collab.room, editing ? { elementId: element.id } : null)
  }, [editing, element.id])

  useEffect(() => {
    if (editing) return
    const collab = getCollabContext()
    if (!collab?.enabled || !collab.room) return
    let frag
    try { frag = collab.room.doc.getXmlFragment(`text:${element.id}`) }
    catch { return }
    if (!frag) return
    const refresh = () => {
      try {
        if (frag.length === 0) return
        const pmJson = yXmlFragmentToProsemirrorJSON(frag)
        if (!pmJson) return
        const next = tiptapToParagraphs(pmJson)
        if (next.kind === "paragraphs") setContent(next)
      } catch { /* ignore */ }
    }
    frag.observeDeep(refresh)
    return () => { frag.unobserveDeep(refresh) }
  }, [editing, element.id])

  const editContent = content ?? { kind: "paragraphs" as const, paragraphs: [] }

  // Native SVG rendering — all presets; unknown presets fall through shapeProps() default → rect

  // Build idle HTML for text overlay
  const idleHtml = useMemo(() => {
    if (!content || content.paragraphs.length === 0) return ""
    try {
      const json = paragraphsToTiptap(content)
      return generateHTML(json, bridgeExtensions())
    } catch { return "" }
  }, [content])

  // Text frame style: vertical anchor, insets, word wrap
  const textZoom = style?.font_scale != null && style.font_scale < 100000
    ? style.font_scale / 100000
    : undefined

  const textFrameStyle = useMemo((): React.CSSProperties => {
    const s = style
    const insets = s?.text_insets
    const padLeft   = insets?.left   != null && element.width_in  > 0 ? `${(insets.left   / element.width_in  * 100).toFixed(2)}%` : "0.18em"
    const padRight  = insets?.right  != null && element.width_in  > 0 ? `${(insets.right  / element.width_in  * 100).toFixed(2)}%` : "0.24em"
    const padTop    = insets?.top    != null && element.height_in > 0 ? `${(insets.top    / element.height_in * 100).toFixed(2)}%` : "0.18em"
    const padBottom = insets?.bottom != null && element.height_in > 0 ? `${(insets.bottom / element.height_in * 100).toFixed(2)}%` : "0.18em"
    const anchorLc = s?.vertical_anchor?.toLowerCase()
    const justifyContent = anchorLc === "middle" || anchorLc === "ctr" || anchorLc === "center" ? "center" : anchorLc === "bottom" || anchorLc === "b" ? "flex-end" : "flex-start"
    const wordWrap = s?.word_wrap === false ? "nowrap" as const : undefined
    return {
      position:    "absolute",
      inset:       0,
      padding:     `${padTop} ${padRight} ${padBottom} ${padLeft}`,
      overflow:    "visible",
      pointerEvents: "none",
      userSelect:  "none",
      display:     "flex",
      flexDirection: "column",
      justifyContent,
      whiteSpace:  wordWrap,
    }
  }, [style, element.width_in, element.height_in])

  if (editing) {
    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <ShapeSvg id={element.id} preset={preset} style={style} flipH={element.flip_h} flipV={element.flip_v} elementWidthIn={element.width_in} />
        </div>
        <ShapeTextEditor
          elementId={element.id}
          docId={docId}
          slideN={slideN}
          initialContent={editContent}
          onSaved={(c) => { setContent(c); setEditing(false) }}
          onCancel={() => setEditing(false)}
          transparent
          textFrameStyle={textFrameStyle}
          textZoom={textZoom}
        />
      </div>
    )
  }

  return (
    <div
      style={{ width: "100%", height: "100%", position: "relative", cursor: selected ? "text" : undefined }}
      onClick={() => { if (selected) setEditing(true) }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
    >
      {/* SVG shape body */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <ShapeSvg id={element.id} preset={preset} adj={element.geometry_adjustments} style={style} flipH={element.flip_h} flipV={element.flip_v} elementWidthIn={element.width_in} />
      </div>
      {/* Text overlay (static HTML when idle) */}
      {idleHtml && (
        <div className="tiptap-text-idle" style={textFrameStyle}>
          <div
            style={textZoom != null ? { zoom: textZoom } as React.CSSProperties : undefined}
            dangerouslySetInnerHTML={{ __html: idleHtml }}
          />
        </div>
      )}
    </div>
  )
}

// ── Text editor overlay ───────────────────────────────────────────────────────

function ShapeTextEditor({
  elementId, docId, slideN, initialContent, onSaved, onCancel, transparent, textFrameStyle, textZoom,
}: {
  elementId:       string
  docId:           string
  slideN:          number
  initialContent:  ParagraphsTextContent
  onSaved:         (c: ParagraphsTextContent) => void
  onCancel:        () => void
  transparent?:    boolean
  textFrameStyle?: React.CSSProperties
  textZoom?:       number
}) {
  const initialJSON = useRef(paragraphsToTiptap(initialContent)).current
  const lastSavedJSON = useRef<string>("")
  const collab = getCollabContext()

  const collabRoom = collab?.enabled ? collab.room : null
  const collabKey  = collabRoom?.roomId ?? "local"

  const extensions = useMemo(() => {
    if (!collabRoom) return bridgeExtensions()
    try {
      hydrateElementText(collabRoom, elementId, initialContent)
      const field = `text:${elementId}`
      const probe = collabRoom.doc.getXmlFragment(field)
      if (!probe || probe.doc !== collabRoom.doc) return bridgeExtensions()
      void getAwareness(collabRoom)
      return [
        ...bridgeExtensions({ collab: true }),
        Collaboration.configure({ document: collabRoom.doc, field }),
      ]
    } catch (e) {
      console.warn("[Percy] BridgeShapeRenderer collab init failed:", e)
      return bridgeExtensions()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabKey, elementId])

  const isCollabActive = collabRoom != null && extensions.length > bridgeExtensions().length

  const editor = useEditor({
    extensions,
    content: isCollabActive ? undefined : initialJSON,
    autofocus: "end",
    editorProps: { attributes: { class: "tiptap-bridge-editor", spellcheck: "true" } },
  }, [collabKey])

  useEffect(() => {
    if (!editor) return
    lastSavedJSON.current = JSON.stringify(initialJSON)
  }, [editor, initialJSON])

  const save = useCallback(async () => {
    if (!editor) { onCancel(); return }
    const json = editor.getJSON()
    const jsonStr = JSON.stringify(json)
    if (jsonStr === lastSavedJSON.current) { onCancel(); return }
    const next = tiptapToParagraphs(json)
    if (isCollabActive) {
      lastSavedJSON.current = jsonStr
      studioStore.setTextPayload(elementId, next)
      onSaved(next)
      updateElementText(docId, slideN, elementId, next).catch(() => {})
      return
    }
    try {
      const updated = await updateElementText(docId, slideN, elementId, next)
      studioStore.setTextPayload(elementId, updated)
      if (updated.kind === "paragraphs") {
        lastSavedJSON.current = JSON.stringify(paragraphsToTiptap(updated))
        onSaved(updated)
      } else { onCancel() }
    } catch (e) {
      console.error("BridgeShapeRenderer: text save failed:", e)
      onCancel()
    }
  }, [editor, docId, slideN, elementId, onSaved, onCancel, isCollabActive])

  useEffect(() => {
    if (!editor) return
    return setActiveTiptapEditor({ elementId, editor })
  }, [editor, elementId])

  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel() }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); save() }
    }
    const root = editor.view.dom
    root.addEventListener("keydown", onKey)
    return () => root.removeEventListener("keydown", onKey)
  }, [editor, save, onCancel])

  if (!editor) return null

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        inset: 0,
        boxSizing: "border-box",
        outline: "2px solid rgba(26,115,232,0.85)",
        outlineOffset: "-1px",
        background: "transparent",
        cursor: "text",
        userSelect: "text",
        padding: textFrameStyle?.padding ?? "0.18em 0.24em",
        overflow: "hidden",
        display: textFrameStyle?.display ?? undefined,
        flexDirection: textFrameStyle?.flexDirection ?? undefined,
        justifyContent: textFrameStyle?.justifyContent ?? undefined,
        whiteSpace: textFrameStyle?.whiteSpace ?? undefined,
      }}
    >
      <TextBubbleMenu editor={editor} />
      {textZoom != null
        ? <div style={{ zoom: textZoom } as React.CSSProperties}><EditorContent editor={editor} onBlur={save} /></div>
        : <EditorContent editor={editor} onBlur={save} />
      }
    </div>
  )
}

export function registerBridgeShapeRenderer(): void {
  registerRenderer("BridgeShape", BridgeShapeRendererImpl)
}
