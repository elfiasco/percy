import { useState, useEffect, useCallback, useRef } from "react"
import { getSlideNotes, updateSlideNotes } from "../../lib/studioApi"

interface Props {
  docId: string
  slideN: number
}

export default function StudioNotesBar({ docId, slideN }: Props) {
  const [open, setOpen]       = useState(false)
  const [text, setText]       = useState("")
  const [saved, setSaved]     = useState(true)
  const [saving, setSaving]   = useState(false)
  const [copied, setCopied]   = useState(false)
  const saveTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSlideRef          = useRef(slideN)
  const textareaRef           = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    lastSlideRef.current = slideN
    getSlideNotes(docId, slideN)
      .then((r) => { setText(r.notes_text); setSaved(true) })
      .catch(() => {})
  }, [docId, slideN])

  const save = useCallback(async (val: string) => {
    setSaving(true)
    try {
      await updateSlideNotes(docId, lastSlideRef.current, val)
      setSaved(true)
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }, [docId])

  const handleChange = useCallback((val: string) => {
    setText(val)
    setSaved(false)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => save(val), 800)
  }, [save])

  const handleCopy = useCallback(async () => {
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* non-fatal */ }
  }, [text])

  const handleClear = useCallback(() => {
    handleChange("")
    textareaRef.current?.focus()
  }, [handleChange])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0
  const charCount = text.length

  return (
    <div className="shrink-0 border-t border-edge bg-surface/50 flex flex-col">
      {/* toggle header */}
      <div className="flex items-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted hover:text-slate-200 transition-colors flex-1 text-left select-none"
        >
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          <span className="font-semibold uppercase tracking-widest">Speaker Notes</span>
          {text.trim() && !open && (
            <span className="ml-1 text-muted/50 truncate max-w-xs">{text.split("\n")[0].slice(0, 60)}</span>
          )}
        </button>
        <div className="flex items-center gap-1.5 pr-3 shrink-0">
          {wordCount > 0 && (
            <span className="text-muted/40 text-[9px]">{wordCount}w · {charCount}c</span>
          )}
          {saving && <span className="text-muted/40 text-[9px] italic">saving…</span>}
          {!saving && !saved && <span className="text-amber-400/70 text-[9px]">unsaved</span>}
          {open && text.trim() && (
            <button
              onClick={handleCopy}
              title="Copy notes to clipboard"
              className="text-[9px] px-1.5 py-0.5 rounded border border-edge text-muted hover:bg-white/10 transition-colors"
            >
              {copied ? "✓" : "Copy"}
            </button>
          )}
          {open && text.trim() && (
            <button
              onClick={handleClear}
              title="Clear notes"
              className="text-[9px] px-1.5 py-0.5 rounded border border-edge text-muted/60 hover:bg-bad/10 hover:text-bad hover:border-bad/30 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Add speaker notes for this slide…"
            rows={4}
            className="w-full text-[11px] bg-base border border-edge rounded px-2 py-1.5
                       text-slate-300 placeholder:text-muted/40 focus:outline-none focus:border-accent
                       resize-y leading-relaxed min-h-[60px]"
          />
          {charCount > 500 && (
            <p className="text-[9px] text-amber-400/70 text-right">{charCount} characters — consider shortening for readability</p>
          )}
        </div>
      )}
    </div>
  )
}
