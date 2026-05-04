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
      { keys: "Ctrl+C",             desc: "Copy element to clipboard" },
      { keys: "Ctrl+V",             desc: "Paste element on current slide" },
      { keys: "Ctrl+Shift+C",       desc: "Format Painter — copy element style" },
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
      { keys: "Ctrl+K",             desc: "Jump to element (command palette)" },
      { keys: "?",                  desc: "Show this help" },
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
                      <td className="py-0.5 pr-3 font-mono text-[11px] text-indigo-300 whitespace-nowrap">
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
