import { useState, useEffect, useCallback, useRef } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import Link from "@tiptap/extension-link"
import { getSlideNotes, updateSlideNotes, generateSlideNotes, transformSlideNotes } from "../../lib/studioApi"

interface Props {
  docId: string
  slideN: number
  wpm?: number
}

const NOTE_TEMPLATES: Array<{ label: string; html: string }> = [
  { label: "Hook → Story → CTA",
    html: "<p><strong>HOOK:</strong> </p><p><strong>STORY:</strong> </p><p><strong>CALL TO ACTION:</strong> </p>" },
  { label: "Problem → Solution → Benefit",
    html: "<p><strong>PROBLEM:</strong> </p><p><strong>SOLUTION:</strong> </p><p><strong>BENEFIT:</strong> </p>" },
  { label: "STAR (Situation → Task → Action → Result)",
    html: "<p><strong>SITUATION:</strong> </p><p><strong>TASK:</strong> </p><p><strong>ACTION:</strong> </p><p><strong>RESULT:</strong> </p>" },
  { label: "Transition slide",
    html: "<p>Transition to the next section.</p><p><em>Key takeaway from previous section:</em> </p><p><em>What's coming next:</em> </p>" },
  { label: "Data / chart slide",
    html: "<p><strong>Key insight:</strong> </p><p><strong>Context:</strong> </p><p><strong>So what:</strong> </p>" },
  { label: "Talking points (bullets)",
    html: "<ul><li></li><li></li><li></li></ul>" },
]

// ── Plain-text helpers (the API still expects plain text) ────────────────────
function htmlToPlainText(html: string): string {
  const tmp = document.createElement("div")
  tmp.innerHTML = html
  // Convert <li> to bullet lines, <p>/<br> to newlines
  tmp.querySelectorAll("li").forEach((li) => { li.textContent = `• ${li.textContent}` })
  tmp.querySelectorAll("p, div").forEach((b) => { b.textContent = `${b.textContent}\n` })
  tmp.querySelectorAll("br").forEach((b) => { b.replaceWith(document.createTextNode("\n")) })
  return (tmp.textContent || "").replace(/\n{3,}/g, "\n\n").trim()
}

function plainTextToHtml(text: string): string {
  if (!text) return ""
  return text
    .split(/\n\n+/)
    .map((para) => {
      // If every line starts with •, render as bullet list
      const lines = para.split("\n")
      if (lines.every((l) => /^[•\-*]\s/.test(l))) {
        const items = lines.map((l) => `<li>${escapeHtml(l.replace(/^[•\-*]\s/, ""))}</li>`).join("")
        return `<ul>${items}</ul>`
      }
      return `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`
    })
    .join("")
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

// ── Component ────────────────────────────────────────────────────────────────
export default function StudioNotesBar({ docId, slideN, wpm = 130 }: Props) {
  const [open, setOpen]                 = useState(false)
  const [saved, setSaved]               = useState(true)
  const [saving, setSaving]             = useState(false)
  const [copied, setCopied]             = useState(false)
  const [generating, setGenerating]     = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const templatesRef = useRef<HTMLDivElement>(null)
  const [transformOpen, setTransformOpen] = useState(false)
  const [transforming, setTransforming]   = useState(false)
  const transformRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSlideRef = useRef(slideN)
  // Keep current text in a ref for word-count etc., synced with editor.
  const [plainText, setPlainText] = useState("")

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { style: "color:#1a73e8; text-decoration:underline;", rel: "noopener noreferrer", target: "_blank" },
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "tiptap-notes-editor",
        spellcheck: "true",
        style: "outline: none; min-height: 60px; max-height: 240px; overflow-y: auto; padding: 6px 10px; font-size: 12px; line-height: 1.5; color: rgb(var(--paper)); background: rgb(var(--base)); border: 1px solid rgb(var(--surface)); border-radius: 4px;",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML()
      const text = htmlToPlainText(html)
      setPlainText(text)
      setSaved(false)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => save(text), 800)
    },
  }, [])

  // Load notes for this slide
  useEffect(() => {
    lastSlideRef.current = slideN
    getSlideNotes(docId, slideN)
      .then((r) => {
        const html = plainTextToHtml(r.notes_text)
        editor?.commands.setContent(html, { emitUpdate: false })
        setPlainText(r.notes_text)
        setSaved(true)
      })
      .catch(() => {})
  }, [docId, slideN, editor])

  const save = useCallback(async (val: string) => {
    setSaving(true)
    try {
      await updateSlideNotes(docId, lastSlideRef.current, val)
      setSaved(true)
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }, [docId])

  const handleCopy = useCallback(async () => {
    if (!plainText.trim()) return
    try {
      await navigator.clipboard.writeText(plainText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* non-fatal */ }
  }, [plainText])

  const handleClear = useCallback(() => {
    editor?.commands.clearContent(true)
    setPlainText("")
    save("")
  }, [editor, save])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setOpen(true)
    try {
      const r = await generateSlideNotes(docId, slideN)
      const html = plainTextToHtml(r.notes_text)
      editor?.commands.setContent(html, { emitUpdate: false })
      setPlainText(r.notes_text)
      save(r.notes_text)
    } catch { /* non-fatal */ } finally {
      setGenerating(false)
    }
  }, [docId, slideN, editor, save])

  const handleTransform = useCallback(async (op: "expand" | "shorten" | "formal" | "casual" | "bullets" | "translate", lang?: string) => {
    setTransformOpen(false)
    setTransforming(true)
    try {
      const r = await transformSlideNotes(docId, slideN, op, lang)
      const html = plainTextToHtml(r.notes_text)
      editor?.commands.setContent(html, { emitUpdate: false })
      setPlainText(r.notes_text)
      save(r.notes_text)
    } catch (e) { console.error("transform notes failed:", e) }
    finally { setTransforming(false) }
  }, [docId, slideN, editor, save])

  const insertTemplate = useCallback((html: string) => {
    if (!editor) return
    editor.chain().focus().insertContent(html).run()
    setTemplatesOpen(false)
  }, [editor])

  // Click-outside closers for dropdowns
  useEffect(() => {
    if (!templatesOpen) return
    const h = (e: MouseEvent) => { if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) setTemplatesOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [templatesOpen])

  useEffect(() => {
    if (!transformOpen) return
    const h = (e: MouseEvent) => { if (transformRef.current && !transformRef.current.contains(e.target as Node)) setTransformOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [transformOpen])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  const wordCount = plainText.trim() ? plainText.trim().split(/\s+/).length : 0
  const charCount = plainText.length
  const estimatedSecs = wordCount > 0 ? Math.round((wordCount / wpm) * 60) : 0
  const estDisplay = estimatedSecs >= 60
    ? `~${Math.floor(estimatedSecs / 60)}m${estimatedSecs % 60 > 0 ? `${estimatedSecs % 60}s` : ""}`
    : estimatedSecs > 0 ? `~${estimatedSecs}s` : null

  return (
    <div className="shrink-0 border-t border-edge bg-surface/50 flex flex-col">
      <div className="flex items-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted hover:text-slate-200 transition-colors flex-1 text-left select-none"
        >
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          <span className="font-semibold uppercase tracking-widest">Speaker Notes</span>
          {plainText.trim() && !open && (
            <span className="ml-1 text-muted/50 truncate max-w-xs">{plainText.split("\n")[0].slice(0, 60)}</span>
          )}
        </button>
        <div className="flex items-center gap-1.5 pr-3 shrink-0">
          {wordCount > 0 && <span className="text-muted/40 text-[9px]">{wordCount}w{estDisplay ? ` · ${estDisplay}` : ""}</span>}
          {saving && <span className="text-muted/40 text-[9px] italic">saving…</span>}
          {!saving && !saved && <span className="text-amber-400/70 text-[9px]">unsaved</span>}
          {open && plainText.trim() && (
            <button onClick={handleCopy} title="Copy notes" className="text-[9px] px-1.5 py-0.5 rounded border border-edge text-muted hover:bg-white/10 transition-colors">
              {copied ? "✓" : "Copy"}
            </button>
          )}
          {open && plainText.trim() && (
            <button onClick={handleClear} title="Clear notes" className="text-[9px] px-1.5 py-0.5 rounded border border-edge text-muted/60 hover:bg-bad/10 hover:text-bad hover:border-bad/30 transition-colors">
              Clear
            </button>
          )}
          {open && (
            <div className="relative" ref={templatesRef}>
              <button onClick={() => setTemplatesOpen((v) => !v)} title="Insert template"
                className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${templatesOpen ? "border-paper/40 text-paper bg-paper/10" : "border-edge text-muted hover:text-paper hover:border-paper/30"}`}>
                Templates
              </button>
              {templatesOpen && (
                <div className="absolute bottom-full right-0 mb-1 w-56 bg-surface border border-edge rounded-lg shadow-2xl z-50 py-1">
                  {NOTE_TEMPLATES.map((t) => (
                    <button key={t.label} onClick={() => insertTemplate(t.html)}
                      className="w-full text-left text-[10px] px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-slate-100 transition-colors">
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {open && plainText.trim() && (
            <div className="relative" ref={transformRef}>
              <button onClick={() => setTransformOpen((v) => !v)} disabled={transforming}
                title="Transform with AI"
                className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors disabled:opacity-40 ${transformOpen ? "border-paper/40 text-paper bg-paper/15" : "border-paper/30 text-paper/60 hover:bg-paper/10 hover:text-paper"}`}>
                {transforming ? "✨…" : "✨ Transform"}
              </button>
              {transformOpen && (
                <div className="absolute bottom-full right-0 mb-1 w-44 bg-surface border border-edge rounded-lg shadow-2xl z-50 py-1">
                  <div className="px-3 py-1 text-[9px] text-muted/50 uppercase tracking-widest border-b border-edge/50 mb-1">AI Transform</div>
                  {([
                    { op: "expand",  label: "Expand (more detail)" },
                    { op: "shorten", label: "Shorten (concise)" },
                    { op: "formal",  label: "Make formal" },
                    { op: "casual",  label: "Make casual" },
                    { op: "bullets", label: "Convert to bullets" },
                  ] as const).map(({ op, label }) => (
                    <button key={op} onClick={() => handleTransform(op)}
                      className="w-full text-left text-[10px] px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-slate-100 transition-colors">
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={handleGenerate} disabled={generating}
            title="Generate speaker notes with AI"
            className="text-[9px] px-1.5 py-0.5 rounded border border-paper/40 text-paper/70 hover:bg-paper/10 hover:text-paper transition-colors disabled:opacity-40">
            {generating ? "✨…" : "✨ Generate"}
          </button>
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-1">
          {/* Mini formatting toolbar */}
          {editor && (
            <div className="flex items-center gap-0.5 mb-1">
              <NotesFmtBtn editor={editor} cmd={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold (Ctrl+B)" label="B" bold />
              <NotesFmtBtn editor={editor} cmd={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic (Ctrl+I)" label="I" italic />
              <NotesFmtBtn editor={editor} cmd={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline (Ctrl+U)" label="U" underline />
              <NotesFmtBtn editor={editor} cmd={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough" label="S" strike />
              <span className="w-px h-3 bg-edge mx-1" />
              <NotesFmtBtn editor={editor} cmd={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bulleted list" label="•" />
              <NotesFmtBtn editor={editor} cmd={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list" label="1." />
              <span className="w-px h-3 bg-edge mx-1" />
              <NotesFmtBtn editor={editor} cmd={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} active={false} title="Clear formatting" label="✕" />
            </div>
          )}
          <EditorContent editor={editor} />
          {charCount > 500 && (
            <p className="text-[9px] text-amber-400/70 text-right">{charCount} characters — consider shortening</p>
          )}
        </div>
      )}
    </div>
  )
}

function NotesFmtBtn({
  cmd, active, title, label, bold, italic, underline, strike,
}: {
  editor: import("@tiptap/react").Editor
  cmd: () => void
  active: boolean
  title: string
  label: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
}) {
  return (
    <button
      onClick={cmd}
      title={title}
      className={`w-6 h-6 flex items-center justify-center rounded text-[11px] transition-colors ${
        active ? "bg-paper/20 text-paper" : "text-muted hover:bg-white/5 hover:text-paper"
      }`}
      style={{
        fontWeight:     bold      ? 700 : 500,
        fontStyle:      italic    ? "italic" : "normal",
        textDecoration: underline ? "underline" : strike ? "line-through" : "none",
      }}
    >
      {label}
    </button>
  )
}
