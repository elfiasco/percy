import { useState, useEffect } from "react"
import { BubbleMenu } from "@tiptap/react/menus"
import type { Editor } from "@tiptap/core"

/**
 * Google-Slides–style floating mini toolbar that appears above the selection.
 *
 * Layout (mirrors Google Slides):
 *   B  I  U  S  │  ←  ↔  →  ≡  │  − [18] +  │  🎨
 */
export default function TextBubbleMenu({ editor }: { editor: Editor }) {
  // Re-render on every selection / transaction so state stays current.
  const [, tick] = useState(0)
  useEffect(() => {
    const refresh = () => tick((v) => v + 1)
    editor.on("selectionUpdate", refresh)
    editor.on("transaction",     refresh)
    return () => {
      editor.off("selectionUpdate", refresh)
      editor.off("transaction",     refresh)
    }
  }, [editor])

  const ts        = editor.getAttributes("textStyle")
  const fontSize  = typeof ts.fontSize  === "number" ? ts.fontSize  : null
  const fontColor = typeof ts.fontColor === "string" ? ts.fontColor : "#000000"
  const sizeLabel = fontSize != null ? String(Math.round(fontSize)) : "—"

  const Btn = ({
    label, active, onClick, title, style,
  }: {
    label: string; active: boolean; onClick: () => void
    title?: string; style?: React.CSSProperties
  }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      style={style}
      className={`text-[11px] font-semibold h-7 px-2 transition-colors min-w-[26px] ${
        active
          ? "bg-[#e8f0fe] text-[#1a73e8]"
          : "text-[#3c4043] hover:bg-[#f1f3f4]"
      }`}
    >
      {label}
    </button>
  )

  const Divider = () => (
    <div className="w-px bg-[#dadce0] self-stretch my-1" />
  )

  const adjustSize = (delta: number) => {
    const cur = fontSize ?? 18
    const next = Math.max(6, Math.min(200, Math.round(cur + delta)))
    editor.chain().focus().setMark("textStyle", { fontSize: next }).run()
  }

  return (
    <BubbleMenu editor={editor} options={{ placement: "top", offset: 10 }}>
      <div
        className="flex items-stretch bg-white rounded shadow-[0_1px_3px_rgba(60,64,67,0.3),0_4px_8px_rgba(60,64,67,0.15)] overflow-hidden border border-[#dadce0]"
        style={{ fontSize: 13 }}
      >
        {/* Emphasis */}
        <Btn label="B" active={editor.isActive("bold")}
          title="Bold (Ctrl+B)" style={{ fontWeight: 700 }}
          onClick={() => editor.chain().focus().toggleBold().run()} />
        <Btn label="I" active={editor.isActive("italic")}
          title="Italic (Ctrl+I)" style={{ fontStyle: "italic" }}
          onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Btn label="U" active={editor.isActive("underline")}
          title="Underline (Ctrl+U)" style={{ textDecoration: "underline" }}
          onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <Btn label="S" active={editor.isActive("strike")}
          title="Strikethrough" style={{ textDecoration: "line-through" }}
          onClick={() => editor.chain().focus().toggleStrike().run()} />

        <Divider />

        {/* Alignment */}
        <Btn label="⫷" title="Align left"
          active={editor.isActive({ textAlign: "left" }) || !editor.isActive({ textAlign: "center" }) && !editor.isActive({ textAlign: "right" }) && !editor.isActive({ textAlign: "justify" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()} />
        <Btn label="⊟" title="Center"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()} />
        <Btn label="⫸" title="Align right"
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()} />
        <Btn label="≣" title="Justify"
          active={editor.isActive({ textAlign: "justify" })}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()} />

        <Divider />

        {/* Lists (Google Slides parity) */}
        <Btn label="•" title="Bulleted list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <Btn label="1." title="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()} />

        <Divider />

        {/* Link (Ctrl+K equivalent) — quick action without leaving the bubble */}
        <Btn label="🔗" title="Insert / edit link (Ctrl+K)"
          active={editor.isActive("link")}
          onClick={() => {
            // Dispatch the same shortcut as the Studio's Ctrl+K handler
            const evt = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
            document.dispatchEvent(evt)
          }} />

        <Divider />

        {/* Font size stepper */}
        <button
          type="button"
          title="Decrease font size"
          onMouseDown={(e) => { e.preventDefault(); adjustSize(-1) }}
          className="text-[12px] text-[#3c4043] hover:bg-[#f1f3f4] h-7 w-6 flex items-center justify-center"
        >−</button>
        <span className="text-[11px] font-mono text-[#3c4043] h-7 flex items-center justify-center min-w-[28px] select-none">
          {sizeLabel}
        </span>
        <button
          type="button"
          title="Increase font size"
          onMouseDown={(e) => { e.preventDefault(); adjustSize(1) }}
          className="text-[12px] text-[#3c4043] hover:bg-[#f1f3f4] h-7 w-6 flex items-center justify-center"
        >+</button>

        <Divider />

        {/* Text color */}
        <label
          title="Text color"
          className="relative cursor-pointer h-7 w-8 flex items-center justify-center hover:bg-[#f1f3f4]"
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            type="color"
            value={fontColor}
            onChange={(e) => {
              editor.chain().focus().setMark("textStyle", { fontColor: e.target.value }).run()
            }}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
          <div className="flex flex-col items-center gap-0.5 pointer-events-none">
            <span className="text-[11px] font-bold text-[#3c4043]" style={{ color: fontColor }}>A</span>
            <div className="w-4 h-1 rounded-sm" style={{ background: fontColor }} />
          </div>
        </label>
      </div>
    </BubbleMenu>
  )
}
