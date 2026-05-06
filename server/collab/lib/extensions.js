/**
 * Server-side mirror of frontend/src/lib/bridge/extensions/index.ts.
 *
 * The schema must match the client's exactly so that ProseMirror documents
 * created in the browser are valid when we deserialize them server-side
 * for save-back to Bridge.
 *
 * If you change the client's bridgeExtensions(), update this file too.
 */

import StarterKit from "@tiptap/starter-kit"
import Paragraph  from "@tiptap/extension-paragraph"
import { TextStyle } from "@tiptap/extension-text-style"
import TextAlign  from "@tiptap/extension-text-align"
import Color      from "@tiptap/extension-color"
// Underline is included in Tiptap 3 StarterKit by default — don't import
// the standalone extension or we get a "duplicate extension names" warning
// and the server can't construct a clean schema.

// Custom paragraph: spaceBefore / spaceAfter
const BridgeParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      spaceBefore: { default: null },
      spaceAfter:  { default: null },
    }
  },
})

// Custom text-style: fontName / fontSize / fontColor / caps
const BridgeTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontName:  { default: null },
      fontSize:  { default: null },
      fontColor: { default: null },
      caps:      { default: null },
    }
  },
})

export function bridgeExtensions() {
  return [
    StarterKit.configure({
      paragraph: false,
    }),
    BridgeParagraph,
    BridgeTextStyle,
    TextAlign.configure({
      types: ["paragraph"],
      alignments: ["left", "center", "right", "justify"],
      defaultAlignment: "left",
    }),
    Color,
  ]
}
