import StarterKit from "@tiptap/starter-kit"
import TextAlign from "@tiptap/extension-text-align"
import Color from "@tiptap/extension-color"
import { BridgeParagraph }  from "./BridgeParagraph"
import { BridgeTextStyle }  from "./BridgeTextStyle"
// Underline is bundled in Tiptap 3 StarterKit — importing the standalone
// extension causes a "duplicate extension" warning.

/**
 * The standard Tiptap extension set used by every Bridge text-bearing
 * renderer (BridgeText, BridgeShape text, BridgeTable cells). Bundled into
 * a single export so renderers and the bridge adapter stay in sync about
 * which schema a Tiptap doc was produced against.
 */

export function bridgeExtensions() {
  return [
    StarterKit.configure({
      // Replace the default paragraph with our extended one
      paragraph: false,
      // We don't want the StarterKit's history when collaboration is on; the
      // collaboration extension provides its own. For Phase 1 we leave it on.
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

export { BridgeParagraph, BridgeTextStyle }
