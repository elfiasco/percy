import type { JSONContent } from "@tiptap/core"
import type {
  TableTextContent, TableCellData, ParagraphData,
} from "../studioTypes"
import { paragraphsToTiptap, tiptapToParagraphs } from "./tiptapAdapter"

/**
 * TableTextContent ↔ Tiptap adapter.
 * Cell fills and borders are carried through tableCell node attrs so that
 * idle rendering can apply inline styles.
 */

// ── Bridge → Tiptap ──────────────────────────────────────────────────────────

export function tableToTiptap(content: TableTextContent): JSONContent {
  const colWidths = content.column_widths
  const totalColWidth = colWidths && colWidths.length > 0
    ? colWidths.reduce((a, b) => a + b, 0)
    : 0

  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: content.cells.map((row, rowIdx) => {
          const rowHeightIn = content.row_heights?.[rowIdx]
          const rowStyle = rowHeightIn ? `height: ${(rowHeightIn * 72).toFixed(1)}pt` : null
          return {
            type: "tableRow",
            ...(rowStyle ? { attrs: { style: rowStyle } } : {}),
            content: row.map((cell, colIdx) => {
              const colWidthPct = (colWidths && totalColWidth > 0 && colIdx < colWidths.length)
                ? (colWidths[colIdx] / totalColWidth * 100)
                : null
              return cellToTiptap(cell, content, rowIdx, colWidthPct)
            }),
          }
        }),
      },
    ],
  }
}

function cellToTiptap(cell: TableCellData, content: TableTextContent, rowIdx: number, colWidthPct: number | null = null): JSONContent {
  const paragraphs: ParagraphData[] =
    cell.paragraphs && cell.paragraphs.length > 0
      ? cell.paragraphs
      : [{
          idx: 0, alignment: null, space_before: null, space_after: null,
          line_spacing: null, indent_level: null, left_indent: null,
          bullet_type: null, bullet_char: null,
          runs: [{
            idx: 0, text: cell.text || "", is_line_break: false,
            font_name:      cell.font_name,
            font_size:      cell.font_size,
            font_bold:      cell.font_bold,
            font_italic:    cell.font_italic,
            font_underline: null,
            font_color:     cell.font_color ?? null,
            strikethrough:  null,
            font_caps:      null,
            baseline_shift: null,
            char_spacing:   null,
          }],
        }]

  const para = paragraphsToTiptap({ kind: "paragraphs", paragraphs })

  // Build cell style from fill + borders + column width
  const styleparts: string[] = []
  if (colWidthPct != null) styleparts.push(`width: ${colWidthPct.toFixed(2)}%`)
  const fillColor = resolveCellFill(cell, content, rowIdx)
  if (fillColor) styleparts.push(`background-color: ${fillColor}`)
  if (cell.h_align && cell.h_align !== "left") styleparts.push(`text-align: ${cell.h_align}`)
  if (cell.v_align) {
    const vmap: Record<string, string> = { top: "top", middle: "middle", bottom: "bottom" }
    const va = vmap[cell.v_align]
    if (va) styleparts.push(`vertical-align: ${va}`)
  }
  const borderStyle = buildBorderStyle(cell)
  if (borderStyle) styleparts.push(borderStyle)

  const attrs: Record<string, unknown> = {}
  if (styleparts.length > 0) attrs.style = styleparts.join("; ")

  return {
    type: "tableCell",
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    content: para.content ?? [],
  }
}

function resolveCellFill(cell: TableCellData, content: TableTextContent, rowIdx: number): string | null {
  if (cell.fill_color && cell.fill_type !== "none") return cell.fill_color
  // Banded rows fallback
  const props = content.properties
  if (props?.banded_rows && rowIdx % 2 === 1) return "rgba(0,0,0,0.04)"
  return null
}

function buildBorderStyle(cell: TableCellData): string | null {
  if (!cell.borders) return null
  const parts: string[] = []
  const sides = ["top", "bottom", "left", "right"] as const
  for (const side of sides) {
    const b = cell.borders[side]
    if (!b || b.visible === false) continue
    const w = b.width != null ? `${(b.width / 72).toFixed(2)}px` : "1px"
    const c = b.color ?? "#000000"
    const s = dashToCss(b.style) ?? "solid"
    parts.push(`border-${side}: ${w} ${s} ${c}`)
  }
  return parts.length > 0 ? parts.join("; ") : null
}

function dashToCss(dash: string | null): string | null {
  if (!dash || dash === "solid") return "solid"
  if (dash === "dash" || dash.startsWith("lg_dash") || dash === "sys_dash") return "dashed"
  if (dash === "dot" || dash === "sys_dot") return "dotted"
  return "solid"
}

// ── Tiptap → Bridge ──────────────────────────────────────────────────────────

export function tiptapToTable(json: JSONContent): TableTextContent {
  const tableNode = (json.content ?? []).find((c) => c.type === "table")
  if (!tableNode) {
    return { kind: "table", rows: 0, cols: 0, properties: null, cells: [] }
  }
  const rows = tableNode.content ?? []
  const grid: TableCellData[][] = rows.map((row, r) => {
    const cells = row.content ?? []
    return cells.map((cell, c) => cellFromTiptap(cell, r, c))
  })
  return {
    kind: "table",
    rows: grid.length,
    cols: grid[0]?.length ?? 0,
    properties: null,
    cells: grid,
  }
}

function cellFromTiptap(node: JSONContent, row: number, col: number): TableCellData {
  const fakeDoc: JSONContent = { type: "doc", content: node.content ?? [] }
  const paragraphs = tiptapToParagraphs(fakeDoc).paragraphs

  const flat = paragraphs
    .map((p) => p.runs.filter((r) => !r.is_line_break).map((r) => r.text).join(""))
    .join("\n")

  const firstRun = paragraphs[0]?.runs[0]

  return {
    row, col,
    text: flat,
    paragraphs,
    font_name:   firstRun?.font_name   ?? null,
    font_size:   firstRun?.font_size   ?? null,
    font_bold:   firstRun?.font_bold   ?? null,
    font_italic: firstRun?.font_italic ?? null,
    font_color:  firstRun?.font_color  ?? null,
    fill_color:  null,
    fill_type:   null,
    h_align:     null,
    v_align:     null,
    word_wrap:   null,
    merge:       null,
    borders:     null,
  }
}
