import { Table }       from "@tiptap/extension-table"
import { TableRow }    from "@tiptap/extension-table-row"
import { TableCell }   from "@tiptap/extension-table-cell"
import { TableHeader } from "@tiptap/extension-table-header"
import { bridgeExtensions } from "./index"

/**
 * Tiptap extension set for BridgeTable rendering.
 * BridgeTableCell: preserves `style` attribute (fills, borders, alignment, width%).
 * BridgeTableRow:  preserves `style` attribute (row height from Bridge dimensions).
 */

const BridgeTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("style") || null,
        renderHTML: (attrs: { style?: string | null }) =>
          attrs.style ? { style: attrs.style } : {},
      },
    }
  },
})

const BridgeTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("style") || null,
        renderHTML: (attrs: { style?: string | null }) =>
          attrs.style ? { style: attrs.style } : {},
      },
      // Stable row identity that survives insert/delete reorders. Used by
      // tiptapToTable() to reconcile row_heights against the model — knowing
      // exactly which row was removed when a user deletes from the middle.
      rowId: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-row-id") || null,
        renderHTML: (attrs: { rowId?: string | null }) =>
          attrs.rowId ? { "data-row-id": attrs.rowId } : {},
      },
    }
  },
})

export function bridgeTableExtensions() {
  return [
    ...bridgeExtensions(),
    Table.configure({
      resizable:           true,
      lastColumnResizable: true,
      HTMLAttributes: { class: "bridge-table" },
    }),
    BridgeTableRow,
    BridgeTableCell,
    TableHeader,
  ]
}
