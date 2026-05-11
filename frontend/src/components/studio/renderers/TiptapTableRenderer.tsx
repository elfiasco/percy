import { useEffect, useState, useCallback, useRef } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import { updateElementText } from "../../../lib/studioApi"
import type { ParagraphData, TableTextContent, ElementStyleData } from "../../../lib/studioTypes"
import { useStudioTextStylePayload } from "../../../lib/studio/payloadHooks"
import { studioStore } from "../../../lib/studio/store"
import { tableToTiptap, tiptapToTable } from "../../../lib/bridge/tableTiptapAdapter"
import { bridgeTableExtensions } from "../../../lib/bridge/extensions/bridgeTableKit"
import { setActiveTiptapEditor } from "../../../lib/bridge/activeEditor"
import { registerRenderer, type NativeRendererProps } from "./RendererRegistry"
import TextBubbleMenu from "../TextBubbleMenu"

/**
 * Native renderer for BridgeTable — Google Sheets-style "always editable" pattern.
 *
 * The Tiptap editor is mounted ONCE when the renderer first mounts. There is
 * no idle/editing toggle that swaps DOM trees. Instead:
 *
 *   - When NOT selected: editor is set to non-editable (read-only). Pointer
 *     events fall through to the parent ElementOverlay, which handles drag/
 *     select.
 *   - When SELECTED:     editor is editable. Click any cell to focus its
 *     cursor, type to edit, Tab/Shift-Tab to navigate, etc.
 *
 * Why this is better than a toggle:
 *   1. No React state race between selected and editing — there's no edit
 *      mode to enter.
 *   2. Click position lands directly in the cell the user clicked, instead
 *      of requiring two clicks (one to select, one to edit).
 *   3. Cell content is always live and rendered identically whether viewing
 *      or editing — no static→Tiptap visual jump.
 *   4. Save fires on blur, no race with component unmount.
 *
 * Mirrors Google Sheets' approach where the cell editor is always attached
 * but only takes input when the cell has focus.
 */

function TiptapTableRendererImpl({
  element, docId, slideN, renderKey, selected,
}: NativeRendererProps) {
  const [content, setContent] = useState<TableTextContent | null>(null)
  const [style, setStyle]     = useState<ElementStyleData | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const payload = useStudioTextStylePayload(docId, slideN, element.id, renderKey)

  useEffect(() => {
    setError(payload.error)
    if (payload.text) setContent(payload.text.kind === "table" ? payload.text : { kind: "table", rows: 0, cols: 0, properties: null, cells: [] })
    if (payload.style) setStyle(payload.style)
  }, [payload.error, payload.text, payload.style])

  if (error)    return <div style={ERR_STYLE}>! table load failed</div>
  if (!content) return <div style={{ width: "100%", height: "100%" }} />

  const containerStyle: React.CSSProperties = {
    width:     "100%",
    height:    "100%",
    boxSizing: "border-box",
    overflow:  "hidden",     // table should fit element exactly; no scrollbars
    background: style?.fill_color ?? "transparent",
    opacity:   style?.opacity ?? 1,
    padding:   0,            // table CSS already provides cell padding
    fontSize:  "10pt",
  }

  return (
    <PersistentTableEditor
      key={element.id}              // remount on element id change
      elementId={element.id}
      docId={docId}
      slideN={slideN}
      content={content}
      onContentChange={setContent}
      selected={selected}
      containerStyle={containerStyle}
    />
  )
}

const ERR_STYLE: React.CSSProperties = {
  width: "100%", height: "100%",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "#fff5f5", color: "#b91c1c", fontSize: 9, fontFamily: "monospace",
}

// ── TSV/CSV paste parser ─────────────────────────────────────────────────────

function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const result: string[][] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const delimiter = line.includes("\t") ? "\t" : ","
    result.push(line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")))
  }
  return result
}

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
        alignment: null, space_before: null, space_after: null,
        line_spacing: null, indent_level: null, left_indent: null,
        bullet_type: null, bullet_char: null,
        runs: (p.content ?? []).map((run, ri) => ({
          idx: ri, text: run.text ?? "", is_line_break: false,
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

// ── Persistent always-mounted editor (Google Sheets-style) ──────────────────

function PersistentTableEditor({
  elementId, docId, slideN, content, onContentChange, selected, containerStyle,
}: {
  elementId:       string
  docId:           string
  slideN:          number
  content:         TableTextContent
  onContentChange: (c: TableTextContent) => void
  selected:        boolean
  containerStyle:  React.CSSProperties
}) {
  // Build the initial Tiptap JSON from the current bridge content. This runs
  // ONCE per mount — we don't tear down the editor when content changes.
  const initialJSON = useRef(tableToTiptap(content)).current
  const lastSavedJSON = useRef<string>(JSON.stringify(initialJSON))
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Wrapper ref so we can measure the available height and size rows to fill
  const wrapperRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: bridgeTableExtensions(),
    content: initialJSON,
    editable: false,    // start non-editable; flip when selected
    editorProps: {
      attributes: {
        class: "tiptap-bridge-table-editor",
        spellcheck: "true",
        // Force the contenteditable to fill its wrapper. Tiptap/ProseMirror's
        // own CSS uses 'height: auto' which beats our class-based rule in
        // some specificity orders, so set it inline.
        style: "height: 100%; box-sizing: border-box;",
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain")
        if (!text || !text.includes("\t")) return false
        event.preventDefault()
        const rows = parseTsv(text)
        if (rows.length === 0) return true
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
    },
  }, [])

  // Sync editor's editable state to the selected prop. When unselected, the
  // editor is read-only and pointer events fall through to ElementOverlay.
  useEffect(() => {
    if (!editor) return
    editor.setEditable(selected)
  }, [editor, selected])

  // ── Make the table fill the element bounds (Google Sheets behavior) ──
  // HTML tables don't reliably honor height:100% through CSS chains, so we
  // measure the wrapper at runtime and write explicit pixel heights to each
  // <tr>. Re-runs when the wrapper resizes (zoom, element resize, row count
  // change).
  useEffect(() => {
    if (!editor) return
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const resizeRows = () => {
      const root = editor.view.dom as HTMLElement
      const rows = Array.from(root.querySelectorAll("tr"))
      if (rows.length === 0) return
      const available = wrapper.clientHeight
      if (available < 10) return  // wrapper not yet sized
      const perRow = Math.max(20, available / rows.length)
      rows.forEach((tr) => {
        ;(tr as HTMLElement).style.height = `${perRow}px`
      })
    }
    // Debounced version for mutation events — gives Tiptap time to flush DOM
    let pending: ReturnType<typeof setTimeout> | null = null
    const scheduleResize = () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(resizeRows, 50)
    }

    // Initial sizing
    requestAnimationFrame(resizeRows)
    // Wrapper resize (element resize / zoom)
    const ro = new ResizeObserver(resizeRows)
    ro.observe(wrapper)
    // Tiptap transactions (row/column changes)
    const onUpdate = () => scheduleResize()
    editor.on("update", onUpdate)
    // DOM mutations on the table (catches inserts/deletes from context menu)
    const mo = new MutationObserver((mutations) => {
      // Only re-fit if rows changed (added/removed). Style mutations from
      // our own height-setting shouldn't trigger more resizes.
      const rowChange = mutations.some((m) =>
        Array.from(m.addedNodes).some((n) => (n as HTMLElement).tagName === "TR") ||
        Array.from(m.removedNodes).some((n) => (n as HTMLElement).tagName === "TR")
      )
      if (rowChange) scheduleResize()
    })
    mo.observe(editor.view.dom as HTMLElement, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
      editor.off("update", onUpdate)
      if (pending) clearTimeout(pending)
    }
  }, [editor])

  // Save on blur — debounced so cell-to-cell tabbing doesn't hammer the API.
  const save = useCallback(async () => {
    if (!editor) return
    const json = editor.getJSON()
    const jsonStr = JSON.stringify(json)
    if (jsonStr === lastSavedJSON.current) return
    lastSavedJSON.current = jsonStr
    try {
      const next = tiptapToTable(json)
      const updated = await updateElementText(docId, slideN, elementId, next)
      studioStore.setTextPayload(elementId, updated)
      if (updated.kind === "table") onContentChange(updated)
    } catch (e) {
      console.error("[Percy] table save failed:", e)
    }
  }, [editor, docId, slideN, elementId, onContentChange])

  // Debounced auto-save on every transaction (Google Sheets-style live save).
  useEffect(() => {
    if (!editor) return
    const onTx = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(save, 600)
    }
    editor.on("update", onTx)
    return () => { editor.off("update", onTx); if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [editor, save])

  // Register as the active Tiptap editor when this is the focused/selected one
  // — lets the ribbon's text-format buttons target this editor.
  useEffect(() => {
    if (!editor || !selected) return
    return setActiveTiptapEditor({ elementId, editor })
  }, [editor, elementId, selected])

  // Keyboard shortcuts only when editor has focus (selected + editing).
  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent) => {
      if (!editor.isEditable) return
      if ((e.ctrlKey || e.metaKey) && e.key === "m" && !e.shiftKey) {
        e.preventDefault()
        editor.chain().focus().mergeCells().run()
      } else if ((e.ctrlKey || e.metaKey) && e.key === "m" && e.shiftKey) {
        e.preventDefault()
        editor.chain().focus().splitCell().run()
      } else if (e.key === "Escape" && editor.isFocused) {
        // Blur Tiptap on Escape — flush save and let ElementOverlay's keyboard
        // handler take the next Escape to deselect.
        e.preventDefault()
        ;(editor.view.dom as HTMLElement).blur()
        if (saveTimer.current) { clearTimeout(saveTimer.current); save() }
      }
    }
    const root = editor.view.dom
    root.addEventListener("keydown", onKey)
    return () => root.removeEventListener("keydown", onKey)
  }, [editor, save])

  if (!editor) return <div style={containerStyle} />

  return (
    <div
      ref={wrapperRef}
      // Stop bubbling for pointer events so ElementOverlay's drag handler
      // doesn't interfere with cell focusing — but only while selected (so
      // unselected tables can still be dragged from anywhere on their face).
      onPointerDown={selected ? (e) => e.stopPropagation() : undefined}
      onMouseDown={selected ? (e) => e.stopPropagation() : undefined}
      onClick={selected ? (e) => e.stopPropagation() : undefined}
      onContextMenu={selected ? (e) => {
        // Only handle right-clicks INSIDE the table; outside the table area
        // (rare since editor fills wrapper) fall through to browser default.
        const target = e.target as HTMLElement
        if (target.closest("table")) {
          e.preventDefault()
          e.stopPropagation()
          window.dispatchEvent(new CustomEvent("percy:table-cell-ctx", {
            detail: { x: e.clientX, y: e.clientY, elementId },
          }))
        }
      } : undefined}
      style={{
        ...containerStyle,
        cursor:   selected ? "text" : "default",
        userSelect: selected ? "text" : "none",
        position: "relative",
      }}
    >
      {selected && <TableCellContextMenu editor={editor} elementId={elementId} />}
      {selected && <TableMergeSplitHint editor={editor} />}
      {selected && <TextBubbleMenu editor={editor} />}
      <EditorContent editor={editor} onBlur={save} style={{ height: "100%" }} />
    </div>
  )
}

// ── Merge/split toolbar hint (shown when cells are selected) ────────────────

// ── Right-click table cell context menu (Google Sheets parity) ─────────────
// Listens for the global 'percy:table-cell-ctx' event dispatched by the
// renderer's onContextMenu and shows a Material Design menu at the click
// position. Items execute Tiptap table commands via the editor chain.

function TableCellContextMenu({
  editor, elementId,
}: { editor: ReturnType<typeof useEditor>; elementId: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onShow = (e: Event) => {
      const detail = (e as CustomEvent).detail as { x: number; y: number; elementId: string }
      if (detail?.elementId !== elementId) return
      setPos({ x: detail.x, y: detail.y })
    }
    window.addEventListener("percy:table-cell-ctx", onShow)
    return () => window.removeEventListener("percy:table-cell-ctx", onShow)
  }, [elementId])

  useEffect(() => {
    if (!pos) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest("[data-table-ctx]")) setPos(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [pos])

  if (!pos || !editor) return null

  const exec = (fn: () => void) => () => { fn(); setPos(null) }

  // Capabilities query Tiptap can answer right now
  const canMerge       = editor.can().mergeCells()
  const canSplit       = editor.can().splitCell()
  const canDeleteRow   = editor.can().deleteRow()
  const canDeleteCol   = editor.can().deleteColumn()
  const canDeleteTable = editor.can().deleteTable()

  interface Item { label: string; shortcut?: string; onClick: () => void; disabled?: boolean; danger?: boolean }
  const items: (Item | "divider")[] = [
    { label: "Cut",        shortcut: "⌘X", onClick: exec(() => { document.execCommand("cut") }) },
    { label: "Copy",       shortcut: "⌘C", onClick: exec(() => { document.execCommand("copy") }) },
    { label: "Paste",      shortcut: "⌘V", onClick: exec(() => { document.execCommand("paste") }) },
    "divider",
    { label: "Insert row above",   onClick: exec(() => editor.chain().focus().addRowBefore().run()) },
    { label: "Insert row below",   onClick: exec(() => editor.chain().focus().addRowAfter().run()) },
    { label: "Insert column left", onClick: exec(() => editor.chain().focus().addColumnBefore().run()) },
    { label: "Insert column right",onClick: exec(() => editor.chain().focus().addColumnAfter().run()) },
    "divider",
    { label: "Delete row",     onClick: exec(() => editor.chain().focus().deleteRow().run()),    disabled: !canDeleteRow },
    { label: "Delete column",  onClick: exec(() => editor.chain().focus().deleteColumn().run()), disabled: !canDeleteCol },
    "divider",
    { label: "Merge cells",      shortcut: "⌘M",  onClick: exec(() => editor.chain().focus().mergeCells().run()), disabled: !canMerge },
    { label: "Split cell",       shortcut: "⌘⇧M", onClick: exec(() => editor.chain().focus().splitCell().run()),  disabled: !canSplit },
    { label: "Distribute rows",   onClick: exec(() => {
      // Tiptap doesn't have native "distribute rows" — let runtime ResizeObserver re-equalize
      const root = editor.view.dom as HTMLElement
      root.querySelectorAll("tr").forEach((tr) => { (tr as HTMLElement).style.removeProperty("height") })
      // The ResizeObserver in PersistentTableEditor will pick this up
      window.dispatchEvent(new Event("resize"))
    }) },
    "divider",
    { label: "Delete table", onClick: exec(() => editor.chain().focus().deleteTable().run()), danger: true, disabled: !canDeleteTable },
  ]

  const left = Math.min(pos.x, window.innerWidth  - 240)
  const top  = Math.min(pos.y, window.innerHeight - 420)

  return (
    <div
      data-table-ctx="true"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed", left, top, zIndex: 100000,
        background: "#fff", border: "1px solid #dadce0", borderRadius: 4,
        boxShadow: "0 2px 10px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.10)",
        minWidth: 220, padding: "4px 0",
        fontFamily: "'Google Sans', system-ui, sans-serif",
        fontSize: 13, color: "#3c4043",
      }}
    >
      {items.map((item, i) =>
        item === "divider" ? (
          <div key={i} style={{ height: 1, background: "#e0e0e0", margin: "4px 0" }} />
        ) : (
          <button
            key={i}
            onClick={item.disabled ? undefined : item.onClick}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              width: "100%", padding: "6px 16px",
              background: "none", border: "none",
              color: item.disabled ? "#bdc1c6" : item.danger ? "#d93025" : "#3c4043",
              fontSize: 13, lineHeight: "20px",
              fontFamily: "inherit", textAlign: "left",
              cursor: item.disabled ? "default" : "pointer",
              opacity: item.disabled ? 0.6 : 1,
            }}
            onMouseEnter={(e) => { if (!item.disabled) (e.currentTarget as HTMLButtonElement).style.background = "#f1f3f4" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none" }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span style={{ fontSize: 11, color: "#80868b", marginLeft: 16 }}>{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  )
}

function TableMergeSplitHint({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null
  const canMerge = editor.can().mergeCells()
  const canSplit = editor.can().splitCell()
  if (!canMerge && !canSplit) return null

  return (
    <div style={{
      position: "absolute", top: -22, left: 0,
      display: "flex", gap: 4, zIndex: 10, pointerEvents: "all",
    }}>
      {canMerge && (
        <button type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().mergeCells().run() }}
          style={HINT_BTN} title="Merge cells (Ctrl+M)"
        >Merge</button>
      )}
      {canSplit && (
        <button type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().splitCell().run() }}
          style={HINT_BTN} title="Split cell (Ctrl+Shift+M)"
        >Split</button>
      )}
    </div>
  )
}

const HINT_BTN: React.CSSProperties = {
  fontSize: 10, padding: "1px 6px",
  background: "#fff", border: "1px solid #dadce0", borderRadius: 3,
  cursor: "pointer", color: "#3c4043", lineHeight: "1.4",
}

export function registerTiptapTableRenderer(): void {
  registerRenderer("BridgeTable", TiptapTableRendererImpl)
}

// ── named exports for testing ───────────────────────────────────────────────
export { parseTsv, tiptapTableToTableContent }
