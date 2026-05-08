import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import TextBubbleMenu from "../TextBubbleMenu"
import { useEditor, EditorContent } from "@tiptap/react"
import Collaboration from "@tiptap/extension-collaboration"
import type { ParagraphsTextContent } from "../../../lib/studioTypes"
import { updateElementText, elementPngUrl } from "../../../lib/studioApi"
import { useStudioTextPayload } from "../../../lib/studio/payloadHooks"
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

/**
 * TiptapShapeRenderer — composite renderer for BridgeShape.
 *
 * Shape geometry comes from the server-side PNG (the existing render
 * pipeline knows about all the shape primitives — rect, ellipse, arrow,
 * star, etc.). Text on top of the shape is edited natively via Tiptap.
 *
 * Three visual states:
 *
 *   1. Idle, has text       : show PNG (which already has the text rendered
 *                              into the shape) — no overlay.
 *   2. Idle, no text         : show PNG only.
 *   3. Editing               : hide the PNG's text by overlaying a Tiptap
 *                              editor on top of the shape; the shape's fill
 *                              color is the background, so the rasterized
 *                              text (which still exists in the PNG underneath)
 *                              is hidden by the overlay's fill.
 *
 * On save, the server re-renders the PNG with the new text — next idle
 * paint shows the updated text rasterized in the shape, and we drop the
 * overlay.
 */

function TiptapShapeRendererImpl({
  element, docId, slideN, renderKey, selected,
}: NativeRendererProps) {
  const [content, setContent] = useState<ParagraphsTextContent | null>(null)
  const [editing, setEditing] = useState(false)
  const [imgError, setImgError] = useState(false)
  const payload = useStudioTextPayload(docId, slideN, element.id, renderKey)

  // Fetch text content (paragraphs/runs) — used for the overlay's content
  // and for hydrating Yjs in collab mode. We don't need element style here
  // because the PNG already bakes fill/border in.
  useEffect(() => {
    if (payload.text) setContent(payload.text.kind === "paragraphs" ? payload.text : null)
  }, [payload.text])

  // Track whether the element has ever been explicitly selected so we know when
  // a deselect is intentional vs just the initial unselected state on mount.
  const hasBeenSelectedRef = useRef(false)
  useEffect(() => {
    if (selected) hasBeenSelectedRef.current = true
    if (!selected && editing && hasBeenSelectedRef.current) setEditing(false)
  }, [selected, editing])

  // Auto-enter edit mode when this element was just inserted (text box insert).
  // No `selected` guard — selectedIds in StudioCanvas is internal and won't be
  // set yet when this effect fires on first mount after a programmatic insert.
  useEffect(() => {
    if (consumePendingAutoEdit(element.id)) setEditing(true)
  }, [element.id])

  // Broadcast edit-presence so peers know we're typing here.
  useEffect(() => {
    const collab = getCollabContext()
    if (!collab?.enabled || !collab.room) return
    setLocalEditing(collab.room, editing ? { elementId: element.id } : null)
  }, [editing, element.id])

  // Phase A round-out — subscribe to remote text edits while idle so peers'
  // updates land in the static rendering. Same pattern as TiptapTextRenderer.
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

  const pngUrl = `${elementPngUrl(docId, slideN, element.id)}?v=${renderKey}`

  const editContent = content ?? { kind: "paragraphs" as const, paragraphs: [] }
  if (editing) {
    return (
      <ShapeTextEditor
        elementId={element.id}
        docId={docId}
        slideN={slideN}
        initialContent={editContent}
        onSaved={(c) => { setContent(c); setEditing(false) }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  // Idle: just the PNG. Click → enter editing if there's text capability.
  return (
    <div
      style={{
        width: "100%", height: "100%", position: "relative",
        cursor: selected ? "text" : undefined,
      }}
      onClick={() => { setEditing(true) }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
    >
      {imgError ? (
        <div style={{
          width: "100%", height: "100%",
          background: "rgba(99,102,241,0.05)",
          border: "1px dashed rgba(99,102,241,0.3)",
        }} />
      ) : (
        <img
          src={pngUrl}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", display: "block", objectFit: "fill", userSelect: "none", pointerEvents: "none" }}
          onError={() => setImgError(true)}
        />
      )}
    </div>
  )
}

// ── live editor (full-size overlay over the shape) ───────────────────────────

function ShapeTextEditor({
  elementId, docId, slideN, initialContent, onSaved, onCancel,
}: {
  elementId:      string
  docId:          string
  slideN:         number
  initialContent: ParagraphsTextContent
  onSaved:        (c: ParagraphsTextContent) => void
  onCancel:       () => void
}) {
  const initialJSON = useRef(paragraphsToTiptap(initialContent)).current
  const lastSavedJSON = useRef<string>("")
  const collab = getCollabContext()

  // Memoized + defensive — see TiptapTextRenderer for the full reasoning.
  const collabRoom = collab?.enabled ? collab.room : null
  const collabKey = collabRoom?.roomId ?? "local"
  const extensions = useMemo(() => {
    if (!collabRoom) return bridgeExtensions()
    try {
      hydrateElementText(collabRoom, elementId, initialContent)
      const field = `text:${elementId}`
      // Sanity-check: y-tiptap's binding crashes on `yXmlFragment.doc` if
      // the fragment doesn't have an attached doc. Validate now and bail
      // to plain Tiptap if Y.js gave us anything weird.
      const probe = collabRoom.doc.getXmlFragment(field)
      if (!probe || probe.doc !== collabRoom.doc) {
        console.warn("[Percy] shape: probe fragment unattached", { hasDoc: !!probe?.doc })
        return bridgeExtensions()
      }
      void getAwareness(collabRoom)
      return [
        ...bridgeExtensions({ collab: true }),
        Collaboration.configure({ document: collabRoom.doc, field }),
        // CollaborationCursor temporarily disabled (see TiptapTextRenderer note).
      ]
    } catch (e) {
      console.warn("[Percy] shape Tiptap collab init failed; falling back to local-only:", e)
      return bridgeExtensions()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabKey, elementId])

  const isCollabActive = collabRoom != null && extensions.length > bridgeExtensions().length

  const editor = useEditor({
    extensions,
    content: isCollabActive ? undefined : initialJSON,
    autofocus: "end",
    editorProps: {
      attributes: {
        class: "tiptap-bridge-editor",
        spellcheck: "true",
      },
    },
  }, [collabKey])

  useEffect(() => {
    if (!editor) return
    lastSavedJSON.current = JSON.stringify(initialJSON)
  }, [editor, initialJSON])

  // Phase A — local-first save. See TiptapTextRenderer for full reasoning.
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
      } else { onCancel() }
    } catch (e) {
      console.error("shape text save (legacy API path) failed:", e)
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
        width: "100%", height: "100%",
        boxSizing: "border-box",
        outline: "1.5px solid rgb(var(--champagne) / 0.65)",
        outlineOffset: "-1.5px",
        // Solid background that hides the PNG underneath while editing,
        // so the user sees only their live text. Use the surface color
        // of the current theme so it doesn't look out of place.
        background: "rgb(var(--surface))",
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

export function registerTiptapShapeRenderer(): void {
  registerRenderer("BridgeShape", TiptapShapeRendererImpl)
}
