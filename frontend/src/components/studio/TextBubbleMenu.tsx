import { BubbleMenu } from "@tiptap/react/menus"
import type { Editor } from "@tiptap/core"

/**
 * PowerPoint-style floating text-format toolbar that appears above the
 * selection when the user has highlighted text inside a Tiptap editor.
 *
 * Tiptap's BubbleMenu handles the positioning; we just render the buttons.
 * Bold / Italic / Underline / Strike + a font-size stepper covers the
 * 80%-case formatting users actually want during inline edits.
 */
export default function TextBubbleMenu({ editor }: { editor: Editor }) {
  const Btn = ({
    label, active, onClick,
  }: { label: string; active: boolean; onClick: () => void }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={`text-[11px] font-semibold px-2 h-7 transition-colors ${
        active
          ? "bg-paper text-ink"
          : "text-paper hover:bg-white/10"
      }`}
      style={{ minWidth: 28 }}
    >
      {label}
    </button>
  )

  return (
    <BubbleMenu editor={editor} options={{ placement: "top", offset: 8 }}>
      <div
        className="flex items-stretch border border-edge bg-surface shadow-xl rounded-sm overflow-hidden"
        style={{ backdropFilter: "blur(8px)" }}
      >
        <Btn
          label="B"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <Btn
          label="I"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <Btn
          label="U"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <Btn
          label="S"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <div className="w-px bg-edge self-stretch" />
        <Btn
          label="←"
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        />
        <Btn
          label="↔"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        />
        <Btn
          label="→"
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        />
      </div>
    </BubbleMenu>
  )
}
