import { useEffect } from "react"

const SECTIONS = [
  {
    title: "Selection",
    shortcuts: [
      { keys: "Click",              desc: "Select element" },
      { keys: "Shift+Click",        desc: "Add/remove from multi-selection" },
      { keys: "Ctrl+A",             desc: "Select all elements" },
      { keys: "Tab / Shift+Tab",    desc: "Cycle through elements" },
      { keys: "Esc",                desc: "Deselect all" },
    ],
  },
  {
    title: "Moving & Resizing",
    shortcuts: [
      { keys: "↑↓←→",              desc: "Nudge selected element 0.1 in" },
      { keys: "Shift + ↑↓←→",      desc: "Nudge 1.0 in (×10)" },
      { keys: "Drag element",       desc: "Move element" },
      { keys: "Drag handle",        desc: "Resize element" },
      { keys: "Shift + drag handle", desc: "Resize with aspect ratio lock" },
      { keys: "Drag ↻ handle",      desc: "Rotate element" },
      { keys: "Shift + rotate",     desc: "Snap to 15° increments" },
    ],
  },
  {
    title: "Editing",
    shortcuts: [
      { keys: "Delete / Backspace", desc: "Delete selected element(s)" },
      { keys: "L",                  desc: "Toggle lock on selected element" },
      { keys: "Ctrl+T",             desc: "Insert text box on current slide" },
      { keys: "Ctrl+C",             desc: "Copy element to clipboard" },
      { keys: "Ctrl+V",             desc: "Paste element on current slide (offset) — or paste image from system clipboard" },
      { keys: "Ctrl+Shift+V",       desc: "Paste in place (exact same position)" },
      { keys: "Ctrl+Shift+C",       desc: "Format Painter — copy element style" },
      { keys: "Ctrl+]",             desc: "Bring element forward (z-order)" },
      { keys: "Ctrl+[",             desc: "Send element backward (z-order)" },
      { keys: "Ctrl+D",             desc: "Duplicate selected element(s)" },
      { keys: "Ctrl+Z",             desc: "Undo" },
      { keys: "Ctrl+Y / Ctrl+Shift+Z", desc: "Redo" },
    ],
  },
  {
    title: "Canvas",
    shortcuts: [
      { keys: "G",                  desc: "Toggle grid overlay (0.25 in)" },
      { keys: "S",                  desc: "Toggle snap to grid" },
      { keys: "R",                  desc: "Toggle rulers (inch marks)" },
      { keys: "Ctrl+\\",            desc: "Toggle focus mode (hide all panels)" },
      { keys: "Ctrl+Scroll",        desc: "Zoom in / out" },
      { keys: "Ctrl+= / Ctrl+-",    desc: "Zoom in / out" },
      { keys: "Ctrl+0",             desc: "Reset zoom to 100%" },
    ],
  },
  {
    title: "Document",
    shortcuts: [
      { keys: "Ctrl+S",             desc: "Full rebuild (python-pptx)" },
      { keys: "Ctrl+H / Ctrl+F",    desc: "Find & Replace" },
      { keys: "Ctrl+K",             desc: "Jump to element (command palette) — type > to run actions" },
      { keys: "Ctrl+G",             desc: "Slide sorter grid view" },
      { keys: "Ctrl+B",             desc: "Pin / unpin current slide" },
      { keys: "Ctrl+Shift+B",       desc: "Jump to next pinned slide" },
      { keys: "PageUp / PageDown",  desc: "Previous / next slide" },
      { keys: "Ctrl+↑ / Ctrl+↓",   desc: "Move current slide up / down" },
      { keys: "?",                  desc: "Show this help" },
      { keys: "F5",                 desc: "Start presentation (fullscreen slideshow)" },
      { keys: "N (in present)",     desc: "Toggle presenter notes overlay" },
      { keys: "V (in present)",     desc: "Toggle speaker view (next slide + notes panel)" },
      { keys: "Z (in present)",     desc: "Toggle teleprompter (large notes)" },
      { keys: "L (in present)",     desc: "Toggle laser pointer" },
      { keys: "Ctrl+← → (present)", desc: "Jump to previous / next section" },
      { keys: "M (in present)",      desc: "Toggle slide mini-map strip" },
      { keys: "Notes bar",          desc: "Speaker notes (bottom of canvas)" },
    ],
  },
]

interface Props {
  onClose: () => void
}

export default function KeyboardShortcutsModal({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-xl shadow-2xl w-[600px] max-h-[80vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <span className="text-sm font-semibold text-slate-200">⌨ Keyboard Shortcuts</span>
          <button
            onClick={onClose}
            className="text-muted hover:text-slate-200 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-0 p-5 gap-x-6">
          {SECTIONS.map((sec) => (
            <div key={sec.title} className="mb-4">
              <div className="text-[10px] text-muted uppercase tracking-widest font-semibold mb-2">
                {sec.title}
              </div>
              <table className="w-full border-collapse">
                <tbody>
                  {sec.shortcuts.map(({ keys, desc }) => (
                    <tr key={keys} className="border-b border-edge/20 last:border-0">
                      <td className="py-0.5 pr-3 font-mono text-[11px] text-paper whitespace-nowrap">
                        {keys}
                      </td>
                      <td className="py-0.5 text-xs text-muted">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="px-5 py-2 border-t border-edge text-[10px] text-muted/50 text-center">
          Press Esc or click outside to close
        </div>
      </div>
    </div>
  )
}
