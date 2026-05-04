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
  const saveTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSlideRef          = useRef(slideN)

  // fetch notes when slide changes
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

  // flush on unmount
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  return (
    <div className="shrink-0 border-t border-edge bg-surface/50 flex flex-col">
      {/* toggle header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted hover:text-slate-200 transition-colors w-full text-left select-none"
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="font-semibold uppercase tracking-widest">Speaker Notes</span>
        {text.trim() && !open && (
          <span className="ml-1 text-muted/50 truncate max-w-xs">{text.split("\n")[0].slice(0, 60)}</span>
        )}
        {text.trim() && (
          <span className="ml-auto text-muted/40 text-[9px] shrink-0">
            {text.trim().split(/\s+/).length}w
          </span>
        )}
        {saving && <span className="ml-1 text-muted/40 italic">saving…</span>}
        {!saving && !saved && <span className="ml-1 text-amber-400/70">unsaved</span>}
      </button>

      {open && (
        <textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Add speaker notes for this slide…"
          rows={4}
          className="mx-3 mb-3 text-[11px] bg-base border border-edge rounded px-2 py-1.5
                     text-slate-300 placeholder:text-muted/40 focus:outline-none focus:border-accent
                     resize-none leading-relaxed"
        />
      )}
    </div>
  )
}
