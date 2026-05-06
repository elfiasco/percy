import { useEffect, useState, useCallback, useRef } from "react"
import { useEditor, EditorContent, generateHTML } from "@tiptap/react"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCursor from "@tiptap/extension-collaboration-cursor"
import type { ParagraphsTextContent } from "../../../lib/studioTypes"
import { fetchElementText, updateElementText, elementPngUrl } from "../../../lib/studioApi"
import { paragraphsToTiptap, tiptapToParagraphs } from "../../../lib/bridge/tiptapAdapter"
import { bridgeExtensions } from "../../../lib/bridge/extensions"
import { setActiveTiptapEditor } from "../../../lib/bridge/activeEditor"
import { getCollabContext } from "../../../lib/collab/collabContext"
import { hydrateElementText } from "../../../lib/collab/bridgeYjsSync"
import { getAwareness } from "../../../lib/collab/awareness"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"

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

  // Fetch text content (paragraphs/runs) — used for the overlay's content
  // and for hydrating Yjs in collab mode. We don't need element style here
  // because the PNG already bakes fill/border in.
  useEffect(() => {
    let cancelled = false
    fetchElementText(docId, slideN, element.id)
      .then((c) => { if (!cancelled) setContent(c.kind === "paragraphs" ? c : null) })
      .catch(() => { if (!cancelled) setContent(null) })
  }, [docId, slideN, element.id, renderKey])

  useEffect(() => { if (!selected && editing) setEditing(false) }, [selected, editing])

  const pngUrl = `${elementPngUrl(docId, slideN, element.id)}?v=${renderKey}`

  if (editing && content) {
    return (
      <ShapeTextEditor
        elementId={element.id}
        docId={docId}
        slideN={slideN}
        initialContent={content}
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
      onClick={(e) => {
        if (!selected) return
        e.stopPropagation()
        setEditing(true)
      }}
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

  const extensions = (() => {
    if (collab?.enabled && collab.room) {
      const fragment = hydrateElementText(collab.room, elementId, initialContent)
      const aware = getAwareness(collab.room)
      return [
        ...bridgeExtensions(),
        Collaboration.configure({ fragment }),
        CollaborationCursor.configure({
          provider: { awareness: aware } as unknown as Parameters<typeof CollaborationCursor.configure>[0]["provider"],
          user: { name: collab.user.name, color: collab.user.color },
        }),
      ]
    }
    return bridgeExtensions()
  })()

  const editor = useEditor({
    extensions,
    content: collab?.enabled ? undefined : initialJSON,
    autofocus: "end",
    editorProps: {
      attributes: {
        class: "tiptap-bridge-editor",
        spellcheck: "true",
      },
    },
  }, [collab?.enabled])

  useEffect(() => {
    if (!editor) return
    lastSavedJSON.current = JSON.stringify(initialJSON)
  }, [editor, initialJSON])

  const save = useCallback(async () => {
    if (!editor) { onCancel(); return }
    const json = editor.getJSON()
    if (JSON.stringify(json) === lastSavedJSON.current) { onCancel(); return }
    try {
      const next = tiptapToParagraphs(json)
      const updated = await updateElementText(docId, slideN, elementId, next)
      if (updated.kind === "paragraphs") {
        lastSavedJSON.current = JSON.stringify(paragraphsToTiptap(updated))
        onSaved(updated)
      } else { onCancel() }
    } catch (e) {
      console.error("shape text save failed:", e)
      onCancel()
    }
  }, [editor, docId, slideN, elementId, onSaved, onCancel])

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
        outline: "2px solid var(--accent, #e8c97a)",
        outlineOffset: "-2px",
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
      <EditorContent editor={editor} onBlur={save} />
    </div>
  )
}

export function registerTiptapShapeRenderer(): void {
  registerRenderer("BridgeShape", TiptapShapeRendererImpl)
}
