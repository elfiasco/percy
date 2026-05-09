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
