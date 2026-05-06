import type { JSONContent } from "@tiptap/core"
import type {
  TableTextContent, TableCellData, ParagraphsTextContent, ParagraphData,
} from "../studioTypes"
import { paragraphsToTiptap, tiptapToParagraphs } from "./tiptapAdapter"

/**
 * TableTextContent ↔ Tiptap (with TableKit) adapter.
 *
 * Bridge model:
 *   TableTextContent { rows, cols, cells: TableCellData[][] }
 *     TableCellData { row, col, text, paragraphs[], font_*, ... }
 *
 * ProseMirror table model (from @tiptap/extension-table):
 *   table
 *     tableRow
 *       tableCell
 *         paragraph (one or more)
 *
 * Each cell's `paragraphs` field is exactly the ParagraphData[] that
 * `tiptapAdapter.ts` already round-trips. So this module just composes
 * the table-level wrapping; cell content reuses the existing adapter.
 *
 * Cell-level legacy fields (`font_name`, `font_size`, `font_bold`,
 * `font_italic`) are *not* applied at the cell level here — they're
 * already baked into each run's per-run formatting in `paragraphs`.
 * The flat-string `text` field is ignored on read (paragraphs is the
 * source of truth) and reconstructed on write (concatenate runs).
 */

// ── Bridge → Tiptap ──────────────────────────────────────────────────────────

export function tableToTiptap(content: TableTextContent): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: content.cells.map((row) => ({
          type: "tableRow",
          content: row.map(cellToTiptap),
        })),
      },
    ],
  }
}

function cellToTiptap(cell: TableCellData): JSONContent {
  // Each cell wraps its paragraphs. If the cell is empty, emit a single empty
  // paragraph so the cell is editable.
  const paragraphs: ParagraphData[] =
    cell.paragraphs && cell.paragraphs.length > 0
      ? cell.paragraphs
      : [{
          idx: 0, alignment: null, space_before: null, space_after: null,
          runs: [{
            idx: 0, text: cell.text || "", is_line_break: false,
            font_name:      cell.font_name,
            font_size:      cell.font_size,
            font_bold:      cell.font_bold,
            font_italic:    cell.font_italic,
            font_underline: null,
            font_color:     null,
            strikethrough:  null,
            font_caps:      null,
          }],
        }]

  // Convert via the paragraph adapter, then unwrap the doc → cell content.
  const para = paragraphsToTiptap({ kind: "paragraphs", paragraphs })
  return {
    type: "tableCell",
    content: para.content ?? [],
  }
}

// ── Tiptap → Bridge ──────────────────────────────────────────────────────────

export function tiptapToTable(json: JSONContent): TableTextContent {
  const tableNode = (json.content ?? []).find((c) => c.type === "table")
  if (!tableNode) {
    return { kind: "table", rows: 0, cols: 0, cells: [] }
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
    cells: grid,
  }
}

function cellFromTiptap(node: JSONContent, row: number, col: number): TableCellData {
  // Pretend the cell's content is a doc — then run the paragraph adapter.
  const fakeDoc: JSONContent = { type: "doc", content: node.content ?? [] }
  const paragraphs = tiptapToParagraphs(fakeDoc).paragraphs

  // Reconstruct the flat-string `text` field by joining all runs.
  const flat = paragraphs
    .map((p) => p.runs.filter((r) => !r.is_line_break).map((r) => r.text).join(""))
    .join("\n")

  // Pick representative cell-level legacy fields from the first run, so the
  // backend's existing renderers still get something reasonable if they ignore
  // paragraphs entirely.
  const firstRun = paragraphs[0]?.runs[0]

  return {
    row, col,
    text: flat,
    paragraphs,
    font_name:   firstRun?.font_name   ?? null,
    font_size:   firstRun?.font_size   ?? null,
    font_bold:   firstRun?.font_bold   ?? null,
    font_italic: firstRun?.font_italic ?? null,
  }
}
