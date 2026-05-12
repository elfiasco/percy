import { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from "react"
import { useEditor, EditorContent, generateHTML } from "@tiptap/react"
import Collaboration from "@tiptap/extension-collaboration"
import type { ParagraphsTextContent } from "../../../lib/studioTypes"
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
import { consumePendingAutoEdit } from "../../../lib/pendingAutoEdit"
import TextBubbleMenu from "../TextBubbleMenu"
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror"

/**
 * TiptapTextRenderer — replaces the legacy contentEditable TextRenderer.
 *
 * Rendering modes:
 *   - Idle     : static HTML produced by Tiptap's `generateHTML(json, exts)`.
 *                Cheap; no editor instance mounted.
 *   - Editing  : full Tiptap editor (mounts on click while element is selected).
 *                Saves on blur or Ctrl/Cmd+Enter; bails on Escape.
 *
 * Selection-level formatting is handled by the ribbon's TextFormatGroup
 * via the active-editor singleton; this renderer just registers itself
 * as the active editor while editing.
 */

interface ElementStyleLite {
  fill_color?:    string | null
  line_color?:    string | null
  line_width?:    number | null
  opacity?:       number | null
  vertical_anchor?: string | null
  text_insets?:   { left?: number; right?: number; top?: number; bottom?: number } | null
}

/** Map PPTX line dash style → CSS border-style. */
function dashToBorderStyle(dash: string | null | undefined): string {
  if (!dash) return "solid"
  const d = dash.toLowerCase()
  if (d === "dash" || d.startsWith("lgdash") || d === "sysdash") return "dashed"
  if (d === "dot" || d === "sysdot") return "dotted"
  if (d === "dashdot" || d === "lgdashdot" || d === "sysdashdot") return "dashed"
  return "solid"
}

function TiptapTextRendererImpl({
  element, docId, slideN, renderKey, selected,
}: NativeRendererProps) {
  const [content, setContent] = useState<ParagraphsTextContent | null>(null)
  const [style, setStyle]     = useState<ElementStyleLite | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const payload = useStudioTextStylePayload(docId, slideN, element.id, renderKey)

  // Hydrate local editing state from the store-owned payload cache.
  useEffect(() => {
    setError(payload.error)
    if (payload.text) setContent(payload.text.kind === "paragraphs" ? payload.text : emptyParagraphs())
    if (payload.style) setStyle(payload.style)
  }, [payload.error, payload.text, payload.style])

  // Only exit edit mode when the element is explicitly deselected after having
  // been selected. The hasBeenSelected guard prevents the initial unselected
  // state (on auto-insert) from immediately cancelling editing.
  const hasBeenSelectedRef = useRef(false)
  useEffect(() => {
    if (selected) hasBeenSelectedRef.current = true
    if (!selected && editing && hasBeenSelectedRef.current) setEditing(false)
  }, [selected, editing])

  // Auto-enter edit mode when this element was just inserted.
  // No `selected` guard — selectedIds in StudioCanvas is internal state that
  // hasn't been updated yet when this effect first fires on mount.
  useEffect(() => {
    if (consumePendingAutoEdit(element.id)) setEditing(true)
  }, [element.id])

  // Broadcast edit-presence so peers know we're typing here.
  useEffect(() => {
    const collab = getCollabContext()
    if (!collab?.enabled || !collab.room) return
    setLocalEditing(collab.room, editing ? { elementId: element.id } : null)
  }, [editing, element.id])

  // Phase A round-out — when collab is active and we're in IDLE (non-edit)
  // mode, subscribe to the Y.XmlFragment so other peers' edits visibly land
  // in the static rendering without requiring a re-fetch from the server.
  // The local edit path goes through Tiptap which updates `content` via
  // its own onSaved; this effect handles the *remote* update path.
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
      } catch { /* ignore conversion failures — keep showing last good state */ }
    }
    frag.observeDeep(refresh)
    return () => { frag.unobserveDeep(refresh) }
  }, [editing, element.id])

  // Hooks (autofit refs/state) declared unconditionally up here so they
  // remain stable across the error/loading early returns below. React Rules
  // of Hooks: same number, same order, every render.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [dynamicZoom, setDynamicZoom] = useState<number | undefined>(undefined)
  const explicitTextZoom = style?.font_scale != null && style.font_scale < 100000
    ? style.font_scale / 100000
    : undefined
  // Dynamic auto-fit: when content overflows container, scale text down so
  // it fits — mirrors PowerPoint's normAutofit behavior for text frames
  // without an explicit fontScale.
  useEffect(() => {
    if (explicitTextZoom != null) { setDynamicZoom(undefined); return }
    if (editing) { setDynamicZoom(undefined); return }
    if (!content) return
    const id = requestAnimationFrame(() => {
      const wrap = wrapperRef.current
      const measured = measureRef.current
      if (!wrap || !measured) return
      const containerH = wrap.clientHeight
      const contentH   = measured.scrollHeight
      if (containerH <= 0 || contentH <= 0) return
      if (contentH <= containerH + 1) {
        setDynamicZoom((z) => (z !== undefined ? undefined : z))
        return
      }
      const target = Math.round(Math.max(0.5, containerH / contentH) * 1000) / 1000
      setDynamicZoom((z) => (z === target ? z : target))
    })
    return () => cancelAnimationFrame(id)
  }, [content, editing, explicitTextZoom, element.width_in, element.height_in])

  if (error)    return <div style={ERR_STYLE}>! text load failed</div>
  if (!content) return <div style={{ width: "100%", height: "100%" }} data-percy-loading="text" />

  const isEmpty = !content || (content.kind === "paragraphs" && content.paragraphs.every((p) =>
    !p.runs?.length || p.runs.every((run) => !run.text),
  ))
  const insets   = style?.text_insets
  const W = element.width_in  > 0 ? element.width_in  : 1
  const H = element.height_in > 0 ? element.height_in : 1
  // CSS percentage padding is resolved against the containing block's WIDTH —
  // for top/bottom too. Using top% = top_in/H*100 silently multiplied vertical
  // padding by (element_width/element_height), pushing text 80+px below the
  // element top on wide+short text frames (e.g. titles 1077×75). Express the
  // inset as inches * pt-scale * 72 ≈ inches per vh, scaled by the slide-height-
  // derived --pt-scale so it matches Studio's font-size unit.
  const padTopIn   = insets?.top    ?? 0.05
  const padBotIn   = insets?.bottom ?? 0.05
  const padLeftIn  = insets?.left   ?? 0.1
  const padRightIn = insets?.right  ?? 0.1
  // Horizontal padding scales correctly with width-% since percentage padding
  // resolves against width — keep that path for left/right.
  const padLeft  = `${(padLeftIn  / W * 100).toFixed(2)}%`
  const padRight = `${(padRightIn / W * 100).toFixed(2)}%`
  // Vertical padding expressed in inches → vh via --pt-scale. Same formula
  // BridgeTextStyle uses for font-size: `${pts} * var(--pt-scale) * 1vh`.
  // 1 inch = 72 pt.
  const padTop = `calc(${(padTopIn * 72).toFixed(2)} * var(--pt-scale, 0.1574) * 1vh)`
  const padBot = `calc(${(padBotIn * 72).toFixed(2)} * var(--pt-scale, 0.1574) * 1vh)`
  const anchorLc = style?.vertical_anchor?.toLowerCase()
  const justifyContent = anchorLc === "middle" || anchorLc === "ctr" || anchorLc === "center" ? "center" : anchorLc === "bottom" || anchorLc === "b" ? "flex-end" : "flex-start"

  const textZoom = explicitTextZoom ?? dynamicZoom

  const containerStyle: React.CSSProperties = {
    width:          "100%",
    height:         "100%",
    boxSizing:      "border-box",
    background:     style?.fill_color || "transparent",
    // Border: PPTX text frames can have <a:ln> outlines. line_color may be
    // null when the PPTX uses a theme color that wasn't fully resolved, so
    // we honor line_visible as the authoritative "has border" signal and
    // default the color to black. Otherwise show the selection dashed outline
    // when an empty text frame is selected.
    border:         (style?.line_visible && (style?.line_color || style?.line_width != null))
      ? `${(style.line_width ?? 1).toString()}px ${dashToBorderStyle(style.line_dash)} ${style.line_color ?? "#000000"}`
      : selected && isEmpty
        ? "1.5px dashed rgba(99,102,241,0.55)"
        : undefined,
    opacity:        style?.opacity ?? 1,
    padding:        `${padTop} ${padRight} ${padBot} ${padLeft}`,
    overflow:       "visible",
    display:        "flex",
    flexDirection:  "column",
    justifyContent,
  }

  if (editing) {
    return (
      <RichTextEditor
        elementId={element.id}
        docId={docId}
        slideN={slideN}
        initialContent={content}
        containerStyle={containerStyle}
        onSaved={(c) => { setContent(c); setEditing(false) }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  // Idle rendering — pure HTML, no editor instance
  const html = generateHTML(paragraphsToTiptap(content), bridgeExtensions())

  return (
    <div
      ref={wrapperRef}
      style={containerStyle}
      className="tiptap-text-idle"
      onClick={() => { setEditing(true) }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
    >
      {isEmpty ? (
        // Google Slides–style placeholder: visible when selected and empty
        <div
          style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: justifyContent === "flex-end" ? "flex-end" : justifyContent === "center" ? "center" : "flex-start",
            padding: `${padTop} ${padRight} ${padBot} ${padLeft}`,
            color: "rgba(0,0,0,0.3)",
            fontSize: "clamp(9px, 1.4vh, 14px)",
            fontFamily: "'Segoe UI', system-ui, sans-serif",
            fontStyle: "italic",
            pointerEvents: "none",
            userSelect: "none",
            boxSizing: "border-box",
          }}
        >
          Click to add text
        </div>
      ) : (
        <div
          ref={measureRef}
          style={textZoom != null ? { zoom: textZoom } as React.CSSProperties : undefined}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  )
}

const ERR_STYLE: React.CSSProperties = {
  width: "100%", height: "100%",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "#fff5f5", color: "#b91c1c", fontSize: 9, fontFamily: "monospace",
}

function emptyParagraphs(): ParagraphsTextContent {
  return {
    kind: "paragraphs",
    paragraphs: [{
      idx: 0, alignment: null, space_before: null, space_after: null,
      line_spacing: null, indent_level: null, left_indent: null,
      bullet_type: null, bullet_char: null,
      runs: [{
        idx: 0, text: "", is_line_break: false,
        font_name: null, font_size: null,
        font_bold: null, font_italic: null, font_underline: null,
        font_color: null, strikethrough: null, font_caps: null,
        baseline_shift: null, char_spacing: null,
      }],
    }],
  }
}

// ── live editor ──────────────────────────────────────────────────────────────

function RichTextEditor({
  elementId, docId, slideN, initialContent, containerStyle,
  onSaved, onCancel,
}: {
  elementId:      string
  docId:          string
  slideN:         number
  initialContent: ParagraphsTextContent
  containerStyle: React.CSSProperties
  onSaved:        (c: ParagraphsTextContent) => void
  onCancel:       () => void
}) {
  const initialJSON = useRef(paragraphsToTiptap(initialContent)).current
  const lastSavedJSON = useRef<string>("")
  const collab = getCollabContext()

  // Build the extension list once per (collab-room, elementId). Hydration is
  // a side-effect (it writes into the Y.Doc), so we run it inside useMemo —
  // and we wrap it in try/catch so any y-prosemirror / Y.Doc failure falls
  // back to a plain Tiptap editor instead of crashing the whole renderer.
  // This is the difference between a single textbox showing an error vs.
  // the entire studio page going to the error boundary.
  const collabRoom = collab?.enabled ? collab.room : null
  const collabKey = collabRoom?.roomId ?? "local"
  const extensions = useMemo(() => {
    if (!collabRoom) return bridgeExtensions()
    try {
      hydrateElementText(collabRoom, elementId, initialContent)
      const field = `text:${elementId}`
      const probe = collabRoom.doc.getXmlFragment(field)
      if (!probe || probe.doc !== collabRoom.doc) {
        console.warn("[Percy] text: probe fragment unattached", { hasDoc: !!probe?.doc })
        return bridgeExtensions()
      }
      // Explicitly subscribe to awareness so future presence/cursor work has it.
      void getAwareness(collabRoom)
      return [
        ...bridgeExtensions({ collab: true }),
        Collaboration.configure({ document: collabRoom.doc, field }),
        // CollaborationCursor temporarily disabled — its yCursorPlugin's init
        // calls ySyncPluginKey.getState(state).doc, which crashes if any
        // bug puts the cursor plugin ahead of the sync plugin. Re-enable
        // once we verify Collaboration alone mounts cleanly.
      ]
    } catch (e) {
      // Y.Doc was destroyed / room invalid / y-prosemirror choked. Drop
      // collab for this mount; Tiptap loads from Bridge JSON instead. The
      // user can still edit; multiplayer just doesn't apply to this element
      // until the next remount.
      console.warn("[Percy] Tiptap collab init failed; falling back to local-only:", e)
      return bridgeExtensions()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabKey, elementId])

  const isCollabActive = collabRoom != null && extensions.length > bridgeExtensions().length

  const editor = useEditor({
    extensions,
    // In collab mode the content comes from the shared fragment; passing
    // `content` would clobber it on every mount. If collab init failed,
    // load from Bridge so the element is still editable.
    content: isCollabActive ? undefined : initialJSON,
    autofocus: "end",
    editorProps: {
      attributes: {
        class: "tiptap-bridge-editor",
        spellcheck: "true",
      },
    },
  }, [collabKey])

  // Track previous JSON to skip no-op saves
  useEffect(() => {
    if (!editor) return
    lastSavedJSON.current = JSON.stringify(initialJSON)
  }, [editor, initialJSON])

  // Phase A — local-first.
  //
  // When collab is active, the user's edits are ALREADY in the Y.XmlFragment
  // (Collaboration extension writes there on every keystroke). The collab
  // worker debounces snapshots back to Bridge JSON server-side. We do not
  // need to RPC the API on blur. Calling onSaved with the local Tiptap state
  // updates the parent's text-preview cache without disturbing the editor.
  //
  // When collab is NOT active (fallback path, e.g. ws connection lost), we
  // still need to persist via API so the change isn't lost.
  const save = useCallback(async () => {
    if (!editor) { onCancel(); return }
    const json = editor.getJSON()
    const jsonStr = JSON.stringify(json)
    if (jsonStr === lastSavedJSON.current) { onCancel(); return }
    const next = tiptapToParagraphs(json)
    if (isCollabActive) {
      // Y.Doc is the truth — server worker will persist. Just notify parent.
      lastSavedJSON.current = jsonStr
      studioStore.setTextPayload(elementId, next)
      onSaved(next)
      // Also persist to REST API so text is readable by non-collab clients / tests.
      updateElementText(docId, slideN, elementId, next).catch(() => {})
      return
    }
    try {
      const updated = await updateElementText(docId, slideN, elementId, next)
      studioStore.setTextPayload(elementId, updated)
      if (updated.kind === "paragraphs") {
        lastSavedJSON.current = JSON.stringify(paragraphsToTiptap(updated))
        onSaved(updated)
      } else {
        onCancel()
      }
    } catch (e) {
      console.error("text save (legacy API path) failed:", e)
      onCancel()
    }
  }, [editor, docId, slideN, elementId, onSaved, onCancel, isCollabActive])

  // Register / unregister with the active-editor singleton
  useEffect(() => {
    if (!editor) return
    const cleanup = setActiveTiptapEditor({ elementId, editor })
    return cleanup
  }, [editor, elementId])

  // Keyboard: Esc cancels; Ctrl/Cmd+Enter saves
  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        e.stopPropagation()
        save()
      }
    }
    const root = editor.view.dom
    root.addEventListener("keydown", onKey)
    return () => root.removeEventListener("keydown", onKey)
  }, [editor, save, onCancel])

  if (!editor) {
    return <div style={containerStyle} />
  }

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        ...containerStyle,
        outline:       "2px solid rgba(26,115,232,0.85)",
        outlineOffset: "-1px",
        cursor:        "text",
        userSelect:    "text",
      }}
    >
      <TextBubbleMenu editor={editor} />
      <EditorContent
        editor={editor}
        onBlur={save}
      />
    </div>
  )
}

export function registerTiptapTextRenderer(): void {
  registerRenderer("BridgeText", TiptapTextRendererImpl)
}

export default TiptapTextRendererImpl
