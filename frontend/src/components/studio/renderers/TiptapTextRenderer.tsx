import { useEffect, useState, useCallback, useRef } from "react"
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
import { getAwareness } from "../../../lib/collab/awareness"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"

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

  if (error)    return <div style={ERR_STYLE}>! text load failed</div>
  if (!content) return <div style={{ width: "100%", height: "100%" }} />

  const containerStyle: React.CSSProperties = {
    width:          "100%",
    height:         "100%",
    boxSizing:      "border-box",
    background:     style?.fill_color ?? "transparent",
    border:         style?.line_color ? `${style.line_width ?? 1}px solid ${style.line_color}` : undefined,
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
      onClick={(e) => {
        if (!selected) return
        e.stopPropagation()
        setEditing(true)
      }}
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

  // Build the extension list. In collab mode we drop the StarterKit's history
  // (Collaboration provides its own) and add the Collaboration + cursor
  // extensions hooked to this element's shared Y.XmlFragment.
  const extensions = (() => {
    if (collab?.enabled && collab.room) {
      // Hydrate from Bridge if the fragment is empty (first opener wins);
      // otherwise the existing shared content is the source of truth.
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
    // In collab mode the content comes from the shared fragment; passing
    // `content` would clobber it on every mount.
    content: collab?.enabled ? undefined : initialJSON,
    autofocus: "end",
    editorProps: {
      attributes: {
        class: "tiptap-bridge-editor",
        spellcheck: "true",
      },
    },
  }, [collab?.enabled])

  // Track previous JSON to skip no-op saves
  useEffect(() => {
    if (!editor) return
    lastSavedJSON.current = JSON.stringify(initialJSON)
  }, [editor, initialJSON])

  const save = useCallback(async () => {
    if (!editor) { onCancel(); return }
    const json = editor.getJSON()
    const jsonStr = JSON.stringify(json)
    if (jsonStr === lastSavedJSON.current) {
      onCancel()
      return
    }
    try {
      const next = tiptapToParagraphs(json)
      const updated = await updateElementText(docId, slideN, elementId, next)
      if (updated.kind === "paragraphs") {
        lastSavedJSON.current = JSON.stringify(paragraphsToTiptap(updated))
        onSaved(updated)
      } else {
        onCancel()
      }
    } catch (e) {
      console.error("text save failed:", e)
      onCancel()
    }
  }, [editor, docId, slideN, elementId, onSaved, onCancel])

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
