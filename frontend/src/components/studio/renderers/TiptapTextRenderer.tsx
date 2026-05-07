import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { useEditor, EditorContent, generateHTML } from "@tiptap/react"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCursor from "@tiptap/extension-collaboration-cursor"
import type { ParagraphsTextContent } from "../../../lib/studioTypes"
import { fetchElementText, updateElementText, fetchElementStyle } from "../../../lib/studioApi"
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
}

function TiptapTextRendererImpl({
  element, docId, slideN, renderKey, selected,
}: NativeRendererProps) {
  const [content, setContent] = useState<ParagraphsTextContent | null>(null)
  const [style, setStyle]     = useState<ElementStyleLite | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Load text + style on mount / refresh
  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([
      fetchElementText(docId, slideN, element.id)
        .then((c) => c.kind === "paragraphs" ? c : null)
        .catch(() => null),
      fetchElementStyle(docId, slideN, element.id).catch(() => null),
    ]).then(([textC, styleC]) => {
      if (cancelled) return
      setContent(textC ?? emptyParagraphs())
      setStyle(styleC ?? null)
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [docId, slideN, element.id, renderKey])

  // Exit edit mode if the element is deselected
  useEffect(() => { if (!selected && editing) setEditing(false) }, [selected, editing])

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

  if (error)    return <div style={ERR_STYLE}>! text load failed</div>
  if (!content) return <div style={{ width: "100%", height: "100%" }} />

  const isEmpty = !content || (content.kind === "paragraphs" && content.paragraphs.every((p) => !p.runs?.length && !p.text))
  const containerStyle: React.CSSProperties = {
    width:          "100%",
    height:         "100%",
    boxSizing:      "border-box",
    background:     style?.fill_color || "transparent",
    border:         style?.line_color
      ? `${style.line_width ?? 1}px solid ${style.line_color}`
      : isEmpty
        ? "1.5px dashed rgba(99,102,241,0.55)"
        : undefined,
    opacity:        style?.opacity ?? 1,
    padding:        "0.12em 0.18em",
    overflow:       "hidden",
    display:        "flex",
    flexDirection:  "column",
    justifyContent: "flex-start",
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
      style={containerStyle}
      // PowerPoint-style: a single click on a text box enters edit mode
      // immediately. We intentionally DON'T stopPropagation so the click
      // also bubbles up to ElementOverlay's onSelect — that way the
      // resize/rotate handles appear at the same time as the cursor.
      onClick={() => { setEditing(true) }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
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
      runs: [{
        idx: 0, text: "", is_line_break: false,
        font_name: null, font_size: null,
        font_bold: null, font_italic: null, font_underline: null,
        font_color: null, strikethrough: null, font_caps: null,
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
      onSaved(next)
      return
    }
    try {
      const updated = await updateElementText(docId, slideN, elementId, next)
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
        outline:       "1.5px solid rgb(var(--champagne) / 0.65)",
        outlineOffset: "-1.5px",
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
