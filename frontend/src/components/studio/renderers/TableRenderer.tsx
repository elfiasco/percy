import type { TableCellEditor, CellBorderSide } from "../../../lib/studioTypes"
import { useStudioTablePayload } from "../../../lib/studio/payloadHooks"
import type { NativeRendererProps } from "./RendererRegistry"
import { registerRenderer } from "./RendererRegistry"

function borderStr(b: CellBorderSide | null): string {
  if (!b || !b.visible) return "none"
  const w = b.width ?? 0.75
  const style = (b.style || "solid").toLowerCase()
  let css = "solid"
  if (style.includes("dash")) css = "dashed"
  else if (style.includes("dot")) css = "dotted"
  return `${w}pt ${css} ${b.color || "#666"}`
}

function alignFor(h: string): React.CSSProperties["textAlign"] {
  switch ((h || "").toLowerCase()) {
    case "center":  return "center"
    case "right":   return "right"
    case "justify": return "justify"
    default:        return "left"
  }
}

function vAlignFor(v: string): React.CSSProperties["verticalAlign"] {
  switch ((v || "").toLowerCase()) {
    case "middle": case "ctr": case "center": return "middle"
    case "bottom": case "b":                  return "bottom"
    default:                                  return "top"
  }
}

function CellTd({ cell, fontSize }: { cell: TableCellEditor; fontSize: number | null }) {
  if (cell.merge.is_spanned) return null
  const style: React.CSSProperties = {
    padding: "3px 5px",
    borderTop:    borderStr(cell.borders.top),
    borderBottom: borderStr(cell.borders.bottom),
    borderLeft:   borderStr(cell.borders.left),
    borderRight:  borderStr(cell.borders.right),
    background:   cell.fill_color || undefined,
    color:        cell.font_color || "#222",
    fontFamily:   cell.font_name || undefined,
    fontSize:     (cell.font_size ?? fontSize ?? 11) + "pt",
    fontWeight:   cell.font_bold ? "bold" : undefined,
    fontStyle:    cell.font_italic ? "italic" : undefined,
    textAlign:    alignFor(cell.h_align),
    verticalAlign: vAlignFor(cell.v_align),
    whiteSpace:   cell.word_wrap === false ? "nowrap" : "normal",
    overflow:     "hidden",
    boxSizing:    "border-box",
  }
  return (
    <td
      style={style}
      rowSpan={cell.merge.row_span > 1 ? cell.merge.row_span : undefined}
      colSpan={cell.merge.col_span > 1 ? cell.merge.col_span : undefined}
    >
      {cell.text}
    </td>
  )
}

function TableRendererImpl({ element, docId, slideN, renderKey }: NativeRendererProps) {
  const { data, error } = useStudioTablePayload(docId, slideN, element.id, renderKey)

  if (error) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: "#fff5f5", color: "#b91c1c", fontSize: 10, fontFamily: "monospace" }}>
        Table load failed
      </div>
    )
  }
  if (!data) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", color: "#9ca3af", fontSize: 10, fontFamily: "monospace" }}>
        Loading table…
      </div>
    )
  }

  // column widths normalized as percentages
  const totalW = data.column_widths.reduce((a, b) => a + b, 0) || data.cols
  const colWidthPcts = data.column_widths.length === data.cols
    ? data.column_widths.map((w) => (w / totalW) * 100)
    : new Array(data.cols).fill(100 / data.cols)
  const totalH = data.row_heights.reduce((a, b) => a + b, 0) || data.rows
  const rowHeightPcts = data.row_heights.length === data.rows
    ? data.row_heights.map((h) => (h / totalH) * 100)
    : new Array(data.rows).fill(100 / data.rows)

  return (
    <div style={{
      width: "100%", height: "100%",
      pointerEvents: "none", userSelect: "none",
      background: "transparent", overflow: "hidden", boxSizing: "border-box",
    }}>
      <table style={{
        width: "100%", height: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
        fontFamily: data.defaults.font_name || undefined,
      }}>
        <colgroup>
          {colWidthPcts.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
        </colgroup>
        <tbody>
          {data.cells.map((row, rIdx) => (
            <tr key={rIdx} style={{ height: `${rowHeightPcts[rIdx] ?? (100 / data.rows)}%` }}>
              {row.map((cell) => <CellTd key={`${cell.row}-${cell.col}`} cell={cell} fontSize={data.defaults.font_size} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function registerTableRenderer(): void {
  registerRenderer("BridgeTable", TableRendererImpl)
}

export default TableRendererImpl
