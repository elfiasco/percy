import { useEffect, useState, useCallback, useRef } from "react"
import { useEditor, EditorContent, generateHTML } from "@tiptap/react"
import { fetchElementText, updateElementText, fetchElementStyle } from "../../../lib/studioApi"
import type { TableTextContent, ElementStyleData } from "../../../lib/studioTypes"
import { tableToTiptap, tiptapToTable } from "../../../lib/bridge/tableTiptapAdapter"
import { bridgeTableExtensions } from "../../../lib/bridge/extensions/bridgeTableKit"
import { setActiveTiptapEditor } from "../../../lib/bridge/activeEditor"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"

/**
 * Native renderer for BridgeTable — renders the table as DOM via Tiptap's
 * table extensions. Each cell is a real ProseMirror cell containing
 * Bridge paragraphs/runs, so per-character formatting (bold, italic, color,
 * font, size) works inside cells using the same ribbon controls that drive
 * text elements.
 *
 * Idle: static HTML via generateHTML.
 * Editing: full live editor with cell-by-cell typing, Tab to advance.
 *
 * Save round-trips through the table adapter into the existing
 * TableTextContent path.
 */

function TiptapTableRendererImpl({
  element, docId, slideN, renderKey, selected,
}: NativeRendererProps) {
  const [content, setContent] = useState<TableTextContent | null>(null)
  const [style, setStyle]     = useState<ElementStyleData | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([
      fetchElementText(docId, slideN, element.id)
        .then((c) => c.kind === "table" ? c : null)
        .catch(() => null),
      fetchElementStyle(docId, slideN, element.id).catch(() => null),
    ]).then(([textC, styleC]) => {
      if (cancelled) return
      setContent(textC ?? { kind: "table", rows: 0, cols: 0, cells: [] })
      setStyle(styleC ?? null)
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [docId, slideN, element.id, renderKey])

  useEffect(() => { if (!selected && editing) setEditing(false) }, [selected, editing])

  if (error)    return <div style={ERR_STYLE}>! table load failed</div>
  if (!content) return <div style={{ width: "100%", height: "100%" }} />

  const containerStyle: React.CSSProperties = {
    width:     "100%",
    height:    "100%",
    boxSizing: "border-box",
    overflow:  "auto",
    background: style?.fill_color ?? "transparent",
    opacity:   style?.opacity ?? 1,
    padding:   "0.05em",
    fontSize:  "10pt",
  }

  if (editing) {
    return (
      <RichTableEditor
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

  // Idle render — static HTML
  const html = (() => {
    if (content.cells.length === 0) {
      return '<div style="color: #888; font-size: 10px; padding: 4px">empty table</div>'
    }
    return generateHTML(tableToTiptap(content), bridgeTableExtensions())
  })()

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

// ── live editor ──────────────────────────────────────────────────────────────

function RichTableEditor({
  elementId, docId, slideN, initialContent, containerStyle, onSaved, onCancel,
}: {
  elementId:      string
  docId:          string
  slideN:         number
  initialContent: TableTextContent
  containerStyle: React.CSSProperties
  onSaved:        (c: TableTextContent) => void
  onCancel:       () => void
}) {
  const initialJSON = useRef(tableToTiptap(initialContent)).current
  const lastSavedJSON = useRef<string>("")

  const editor = useEditor({
    extensions: bridgeTableExtensions(),
    content: initialJSON,
    autofocus: "end",
    editorProps: {
      attributes: {
        class: "tiptap-bridge-table-editor",
        spellcheck: "true",
      },
    },
  }, [])

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
      const next = tiptapToTable(json)
      const updated = await updateElementText(docId, slideN, elementId, next)
      if (updated.kind === "table") {
        lastSavedJSON.current = JSON.stringify(tableToTiptap(updated))
        onSaved(updated)
      } else {
        onCancel()
      }
    } catch (e) {
      console.error("table save failed:", e)
      onCancel()
    }
  }, [editor, docId, slideN, elementId, onSaved, onCancel])

  // Register with the active-editor singleton so the ribbon controls
  // drive table cell formatting too.
  useEffect(() => {
    if (!editor) return
    return setActiveTiptapEditor({ elementId, editor })
  }, [editor, elementId])

  // Esc cancels, Cmd/Ctrl+Enter saves
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

  if (!editor) return <div style={containerStyle} />

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        ...containerStyle,
        outline:       "2px solid var(--accent, #e8c97a)",
        outlineOffset: "-2px",
        cursor:        "text",
        userSelect:    "text",
      }}
    >
      <EditorContent editor={editor} onBlur={save} />
    </div>
  )
}

export function registerTiptapTableRenderer(): void {
  registerRenderer("BridgeTable", TiptapTableRendererImpl)
}
