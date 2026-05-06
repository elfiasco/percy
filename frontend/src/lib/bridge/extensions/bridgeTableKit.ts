import { Table }       from "@tiptap/extension-table"
import { TableRow }    from "@tiptap/extension-table-row"
import { TableCell }   from "@tiptap/extension-table-cell"
import { TableHeader } from "@tiptap/extension-table-header"
import { bridgeExtensions } from "./index"

/**
 * Tiptap extension set for BridgeTable rendering — base bridge extensions
 * (paragraph, text, marks) plus the table family configured for our needs:
 *
 *   - Resizable columns (drag the right border of any cell)
 *   - Cells can hold full Bridge paragraphs (lists later, headings later)
 *
 * Reuses the same paragraph + textStyle extensions as text-only renderers
 * so a cell's content is identical-shape to a BridgeText element's content.
 */

export function bridgeTableExtensions() {
  return [
    ...bridgeExtensions(),
    Table.configure({
      resizable:           true,
      lastColumnResizable: true,
      HTMLAttributes: { class: "bridge-table" },
    }),
    TableRow,
    TableCell,
    TableHeader,
  ]
}
