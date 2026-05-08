import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import TextBubbleMenu from "../TextBubbleMenu"
import { useEditor, EditorContent, generateHTML } from "@tiptap/react"
import Collaboration from "@tiptap/extension-collaboration"
import type { ElementStyleData, ParagraphsTextContent } from "../../../lib/studioTypes"
import { updateElementText } from "../../../lib/studioApi"
import { useStudioTextStylePayload } from "../../../lib/studio/payloadHooks"
import { studioStore } from "../../../lib/studio/store"
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

// ── SVG background shape ──────────────────────────────────────────────────────

interface ShapeSvgProps {
  preset:    string | null | undefined
  adj?:      Record<string, string | number>
  style:     ElementStyleData | null
  flipH:     boolean
  flipV:     boolean
}

function ShapeSvg({ preset, adj, style, flipH, flipV }: ShapeSvgProps) {
  const fill = style?.fill_type === "none" || style?.fill_type === null
    ? "none"
    : (style?.fill_color ?? "#E2E8F0")
  const lineVisible = style?.line_visible !== false  // default true unless explicitly false
  const stroke  = (lineVisible && style?.line_color) ? style.line_color : "none"
  const strokeW = (lineVisible && style?.line_width != null)
    ? (style.line_width / 72 * 100 / 13.333).toFixed(3) // convert pt → % of 100-unit viewBox
    : "0"
  const opacity  = style?.opacity ?? 1

  const transform = (flipH || flipV)
    ? `scale(${flipH ? -1 : 1},${flipV ? -1 : 1}) translate(${flipH ? -100 : 0},${flipV ? -100 : 0})`
    : undefined

  const props = shapeProps(preset, adj)
  const { tag, ...svgAttrs } = props
  const shapeEl = tag === "rect"
    ? <rect {...(svgAttrs as React.SVGProps<SVGRectElement>)} fill={fill} stroke={stroke} strokeWidth={strokeW} />
    : tag === "ellipse"
    ? <ellipse {...(svgAttrs as React.SVGProps<SVGEllipseElement>)} fill={fill} stroke={stroke} strokeWidth={strokeW} />
    : tag === "polygon"
    ? <polygon {...(svgAttrs as React.SVGProps<SVGPolygonElement>)} fill={fill} stroke={stroke} strokeWidth={strokeW} />
    : <path {...(svgAttrs as React.SVGProps<SVGPathElement>)} fill={fill} stroke={stroke} strokeWidth={strokeW} />

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      opacity={opacity}
    >
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

  if (editing) {
    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <ShapeSvg preset={preset} style={style} flipH={element.flip_h} flipV={element.flip_v} />
        </div>
        <ShapeTextEditor
          elementId={element.id}
          docId={docId}
          slideN={slideN}
          initialContent={editContent}
          onSaved={(c) => { setContent(c); setEditing(false) }}
          onCancel={() => setEditing(false)}
          transparent
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
        <ShapeSvg preset={preset} style={style} flipH={element.flip_h} flipV={element.flip_v} />
      </div>
      {/* Text overlay (static HTML when idle) */}
      {idleHtml && (
        <div
          className="tiptap-bridge-editor"
          style={{
            position: "absolute",
            inset: 0,
            padding: "0.18em 0.24em",
            overflow: "hidden",
            pointerEvents: "none",
            userSelect: "none",
          }}
          dangerouslySetInnerHTML={{ __html: idleHtml }}
        />
      )}
    </div>
  )
}

// ── Text editor overlay ───────────────────────────────────────────────────────

function ShapeTextEditor({
  elementId, docId, slideN, initialContent, onSaved, onCancel, transparent,
}: {
  elementId:      string
  docId:          string
  slideN:         number
  initialContent: ParagraphsTextContent
  onSaved:        (c: ParagraphsTextContent) => void
  onCancel:       () => void
  transparent?:   boolean
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
        outline: "1.5px solid rgb(var(--champagne) / 0.65)",
        outlineOffset: "-1.5px",
        background: transparent ? "transparent" : "rgb(var(--surface))",
        cursor: "text",
        userSelect: "text",
        padding: "0.18em 0.24em",
        overflow: "hidden",
      }}
    >
      <TextBubbleMenu editor={editor} />
      <EditorContent editor={editor} onBlur={save} />
    </div>
  )
}

export function registerBridgeShapeRenderer(): void {
  registerRenderer("BridgeShape", BridgeShapeRendererImpl)
}
