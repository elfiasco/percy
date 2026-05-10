import { useEffect, useState, useCallback, useRef } from "react"
import { useEditor, EditorContent, generateHTML } from "@tiptap/react"
import { updateElementText } from "../../../lib/studioApi"
import type { ParagraphData, TableTextContent, ElementStyleData } from "../../../lib/studioTypes"
import { useStudioTextStylePayload } from "../../../lib/studio/payloadHooks"
import { studioStore, useEditingElementId } from "../../../lib/studio/store"
import { tableToTiptap, tiptapToTable } from "../../../lib/bridge/tableTiptapAdapter"
import { bridgeTableExtensions } from "../../../lib/bridge/extensions/bridgeTableKit"
import { setActiveTiptapEditor } from "../../../lib/bridge/activeEditor"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"

/**
 * Native renderer for BridgeTable.
 *
 * Idle:    static HTML via generateHTML (no editor overhead).
 * Editing: RichTableEditor — full Tiptap editor with:
 *          - Tab/Shift-Tab to navigate cells
 *          - Arrow keys between cells at paragraph boundary
 *          - Ctrl+M to merge selected cells, Ctrl+Shift+M to split
 *          - TSV/CSV paste: intercepts clipboard text and fills cells
 *          - Column resize via Tiptap's built-in resizable table
 *          - Esc to cancel, Ctrl/Cmd+Enter to save
 */

function TiptapTableRendererImpl({
  element, docId, slideN, renderKey, selected,
}: NativeRendererProps) {
  const [content, setContent] = useState<TableTextContent | null>(null)
  const [style, setStyle]     = useState<ElementStyleData | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const payload = useStudioTextStylePayload(docId, slideN, element.id, renderKey)
  // Subscribe to global "edit this element" signal — set by ElementOverlay's
  // onDoubleClick. This avoids the React batching race where setEditing(true)
  // inside a click handler doesn't see fresh `selected` state.
  const editingElementId = useEditingElementId()

  useEffect(() => {
    setError(payload.error)
    if (payload.text) setContent(payload.text.kind === "table" ? payload.text : { kind: "table", rows: 0, cols: 0, properties: null, cells: [] })
    if (payload.style) setStyle(payload.style)
  }, [payload.error, payload.text, payload.style])

  useEffect(() => { if (!selected && editing) setEditing(false) }, [selected, editing])

  // When the global signal targets this element, flip into edit mode.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[Percy] TiptapTableRenderer effect", { editingElementId, elementId: element.id, editing })
    if (editingElementId === element.id && !editing) {
      // eslint-disable-next-line no-console
      console.log("[Percy] -> setEditing(true) for table", element.id)
      setEditing(true)
      // Consume the signal so re-renders don't re-fire it.
      studioStore.setEditingElement(null)
    }
  }, [editingElementId, element.id, editing])

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

  const html = (() => {
    if (content.cells.length === 0) {
      return '<div style="color: #888; font-size: 10px; padding: 4px">empty table</div>'
    }
    return generateHTML(tableToTiptap(content), bridgeTableExtensions())
  })()

  return (
    <div
      style={containerStyle}
      // NO onDoubleClick here — ElementOverlay handles the dblclick atomically
      // and dispatches the edit-mode signal via studioStore.setEditingElement.
      // Single-click on already-selected table also enters edit mode (matches
      // Google Slides where the second click on a selected table activates
      // cell editing).
      onClick={(e) => {
        if (selected) {
          e.stopPropagation()
          studioStore.setEditingElement(element.id)
        }
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

// ── TSV/CSV paste parser ──────────────────────────────────────────────────────

function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const result: string[][] = []
  for (const line of lines) {
    if (!line.trim()) continue
    // Handle basic CSV (commas only — not full RFC 4180)
    const delimiter = line.includes("\t") ? "\t" : ","
    result.push(line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")))
  }
  return result
}

/**
 * Build a Tiptap table JSON doc from a 2D array of strings.
 * Each cell is rendered as a plain paragraph with no marks.
 */
function tsvToTiptap(rows: string[][]): object {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: rows.map((row) => ({
          type: "tableRow",
          content: row.map((cellText) => ({
            type: "tableCell",
            content: [{ type: "paragraph", content: cellText ? [{ type: "text", text: cellText }] : [] }],
          })),
        })),
      },
    ],
  }
}

function tiptapTableToTableContent(json: object): TableTextContent {
  const cells: ParagraphData[][][] = []
  let rows = 0, cols = 0
  const doc = json as { content?: Array<{ type: string; content?: Array<{ type: string; content?: Array<{ type: string; content?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> }> }> }> }
  const tableNode = doc.content?.find((n) => n.type === "table")
  if (!tableNode) return { kind: "table", rows: 0, cols: 0, properties: null, cells: [] }
  const tableRows = tableNode.content ?? []
  rows = tableRows.length
  for (const row of tableRows) {
    const cellRow: ParagraphData[][] = []
    const cells_ = row.content ?? []
    cols = Math.max(cols, cells_.length)
    for (const cell of cells_) {
      const paragraphs: ParagraphData[] = (cell.content ?? []).map((p, idx) => ({
        idx,
        alignment: null,
        space_before: null,
        space_after: null,
        line_spacing: null,
        indent_level: null,
        left_indent: null,
        bullet_type: null,
        bullet_char: null,
        runs: (p.content ?? []).map((run, ri) => ({
          idx: ri,
          text: run.text ?? "",
          is_line_break: false,
          font_name: null, font_size: null, font_bold: null,
          font_italic: null, font_underline: null,
          font_color: null, strikethrough: null, font_caps: null,
          baseline_shift: null, char_spacing: null,
        })),
      }))
      cellRow.push(paragraphs)
    }
    cells.push(cellRow)
  }
  return { kind: "table", rows, cols, properties: null, cells: cells as unknown as TableTextContent["cells"] }
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
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain")
        if (!text || !text.includes("\t")) return false  // only intercept TSV
        event.preventDefault()
        const rows = parseTsv(text)
        if (rows.length === 0) return true
        // Replace entire table content with the pasted data.
        const newDoc = tsvToTiptap(rows)
        view.dispatch(
          view.state.tr.replaceWith(
            0,
            view.state.doc.content.size,
            (view.state.schema as unknown as { nodeFromJSON(json: object): { content: unknown } }).nodeFromJSON(newDoc).content as unknown as import("prosemirror-model").Fragment,
          ),
        )
        return true
      },
      handleKeyDown(view, event) {
        // Ctrl+M → merge selected cells
        if ((event.ctrlKey || event.metaKey) && event.key === "m" && !event.shiftKey) {
          event.preventDefault()
          return true // handled by merge command below
        }
        return false
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
      studioStore.setTextPayload(elementId, updated)
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

  useEffect(() => {
    if (!editor) return
    return setActiveTiptapEditor({ elementId, editor })
  }, [editor, elementId])

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
      } else if (e.key === "m" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        editor.chain().focus().mergeCells().run()
      } else if (e.key === "m" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault()
        editor.chain().focus().splitCell().run()
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
        cursor:   "text",
        userSelect: "text",
        position: "relative",
      }}
    >
      <TableMergeSplitHint editor={editor} />
      <EditorContent editor={editor} onBlur={save} />
    </div>
  )
}

// ── Merge/split toolbar hint (shown when cells are selected) ─────────────────

function TableMergeSplitHint({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null
  const canMerge  = editor.can().mergeCells()
  const canSplit  = editor.can().splitCell()
  if (!canMerge && !canSplit) return null

  return (
    <div style={{
      position: "absolute",
      top: -22,
      left: 0,
      display: "flex",
      gap: 4,
      zIndex: 10,
      pointerEvents: "all",
    }}>
      {canMerge && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().mergeCells().run() }}
          style={HINT_BTN}
          title="Merge cells (Ctrl+M)"
        >
          Merge
        </button>
      )}
      {canSplit && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().splitCell().run() }}
          style={HINT_BTN}
          title="Split cell (Ctrl+Shift+M)"
        >
          Split
        </button>
      )}
    </div>
  )
}

const HINT_BTN: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  background: "rgb(var(--surface))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 3,
  cursor: "pointer",
  color: "rgb(var(--text-primary))",
  lineHeight: "1.4",
}

export function registerTiptapTableRenderer(): void {
  registerRenderer("BridgeTable", TiptapTableRendererImpl)
}

// ── named exports for testing ─────────────────────────────────────────────────
export { parseTsv, tiptapTableToTableContent }
