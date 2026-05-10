import StarterKit from "@tiptap/starter-kit"
import TextAlign from "@tiptap/extension-text-align"
import Color from "@tiptap/extension-color"
import Link from "@tiptap/extension-link"
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

export function bridgeExtensions(opts: { collab?: boolean } = {}) {
  return [
    StarterKit.configure({
      paragraph: false,
      // Disable StarterKit's built-in Link so our explicit Link.configure()
      // below wins (StarterKit 3 bundles Link; without disabling we get
      // duplicate-extension warnings and Tiptap may fail to init the editor).
      link: false,
      // Collaboration provides its own history (Y.UndoManager). Including
      // StarterKit's history alongside it crashes y-prosemirror's plugin
      // init with "Cannot read properties of undefined (reading 'doc')"
      // because the two history plugins fight over plugin-state ordering.
      ...(opts.collab ? { history: false } : {}),
    }),
    BridgeParagraph,
    BridgeTextStyle,
    TextAlign.configure({
      types: ["paragraph"],
      alignments: ["left", "center", "right", "justify"],
      defaultAlignment: "left",
    }),
    Color,
    Link.configure({
      openOnClick: false,    // we open via the popover, not on click in editor
      autolink: true,        // auto-detect URLs typed in text
      defaultProtocol: "https",
      linkOnPaste: true,
      HTMLAttributes: {
        // GS-style link rendering: blue + underline. Inline style so it shows
        // even before any link CSS classes are applied.
        style: "color: #1a73e8; text-decoration: underline; cursor: pointer;",
        rel: "noopener noreferrer",
        target: "_blank",
      },
    }),
  ]
}

export { BridgeParagraph, BridgeTextStyle }
