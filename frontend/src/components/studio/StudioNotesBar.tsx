import { useState, useEffect, useCallback, useRef } from "react"
import { getSlideNotes, updateSlideNotes, generateSlideNotes, transformSlideNotes } from "../../lib/studioApi"

interface Props {
  docId: string
  slideN: number
  wpm?: number
}

const NOTE_TEMPLATES: Array<{ label: string; text: string }> = [
  {
    label: "Hook → Story → CTA",
    text: "HOOK: \n\nSTORY: \n\nCALL TO ACTION: ",
  },
  {
    label: "Problem → Solution → Benefit",
    text: "PROBLEM: \n\nSOLUTION: \n\nBENEFIT: ",
  },
  {
    label: "STAR (Situation → Task → Action → Result)",
    text: "SITUATION: \n\nTASK: \n\nACTION: \n\nRESULT: ",
  },
  {
    label: "Transition slide",
    text: "Transition to the next section. Briefly summarize what was covered and preview what comes next.\n\nKey takeaway from previous section: \n\nWhat's coming next: ",
  },
  {
    label: "Data / chart slide",
    text: "Key insight from this data: \n\nContext and what drives this number: \n\nSo what — why should the audience care: ",
  },
  {
    label: "Talking points (bullets)",
    text: "• \n• \n• ",
  },
]

export default function StudioNotesBar({ docId, slideN, wpm = 130 }: Props) {
  const [open, setOpen]       = useState(false)
  const [text, setText]       = useState("")
  const [saved, setSaved]     = useState(true)
  const [saving, setSaving]   = useState(false)
  const [copied, setCopied]   = useState(false)
  const [generating, setGenerating] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const templatesRef = useRef<HTMLDivElement>(null)
  const [transformOpen, setTransformOpen] = useState(false)
  const [transforming, setTransforming]   = useState(false)
  const transformRef = useRef<HTMLDivElement>(null)
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

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setOpen(true)
    try {
      const r = await generateSlideNotes(docId, slideN)
      handleChange(r.notes_text)
    } catch { /* non-fatal */ } finally {
      setGenerating(false)
    }
  }, [docId, slideN, handleChange])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  useEffect(() => {
    if (!templatesOpen) return
    const handler = (e: MouseEvent) => {
      if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) {
        setTemplatesOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [templatesOpen])

  useEffect(() => {
    if (!transformOpen) return
    const handler = (e: MouseEvent) => {
      if (transformRef.current && !transformRef.current.contains(e.target as Node)) {
        setTransformOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [transformOpen])

  const handleTransform = useCallback(async (op: "expand" | "shorten" | "formal" | "casual" | "bullets" | "translate", lang?: string) => {
    setTransformOpen(false)
    setTransforming(true)
    try {
      const r = await transformSlideNotes(docId, slideN, op, lang)
      handleChange(r.notes_text)
    } catch (e) { console.error("transform notes failed:", e) }
    finally { setTransforming(false) }
  }, [docId, slideN, handleChange])

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0
  const charCount = text.length
  const estimatedSecs = wordCount > 0 ? Math.round((wordCount / wpm) * 60) : 0
  const estDisplay = estimatedSecs >= 60
    ? `~${Math.floor(estimatedSecs / 60)}m${estimatedSecs % 60 > 0 ? `${estimatedSecs % 60}s` : ""}`
    : estimatedSecs > 0 ? `~${estimatedSecs}s` : null

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
            <span className="text-muted/40 text-[9px]">{wordCount}w{estDisplay ? ` · ${estDisplay}` : ""}</span>
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
          {open && (
            <div className="relative" ref={templatesRef}>
              <button
                onClick={() => setTemplatesOpen((v) => !v)}
                title="Insert note template"
                className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                  templatesOpen
                    ? "border-paper/40 text-paper bg-paper/10"
                    : "border-edge text-muted hover:text-paper hover:border-paper/30"
                }`}
              >
                Templates
              </button>
              {templatesOpen && (
                <div className="absolute bottom-full right-0 mb-1 w-56 bg-surface border border-edge rounded-lg shadow-2xl z-50 py-1">
                  {NOTE_TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      onClick={() => {
                        handleChange(text ? `${text}\n\n${t.text}` : t.text)
                        setTemplatesOpen(false)
                        textareaRef.current?.focus()
                      }}
                      className="w-full text-left text-[10px] px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-slate-100 transition-colors"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {open && text.trim() && (
            <div className="relative" ref={transformRef}>
              <button
                onClick={() => setTransformOpen((v) => !v)}
                disabled={transforming}
                title="Transform notes with AI (expand, shorten, reformat)"
                className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors disabled:opacity-40 ${
                  transformOpen
                    ? "border-paper/40 text-paper bg-paper/15"
                    : "border-paper/30 text-paper/60 hover:bg-paper/10 hover:text-paper"
                }`}
              >
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
                    <button
                      key={op}
                      onClick={() => handleTransform(op)}
                      className="w-full text-left text-[10px] px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-slate-100 transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            title="Generate speaker notes with AI (replaces existing)"
            className="text-[9px] px-1.5 py-0.5 rounded border border-paper/40 text-paper/70 hover:bg-paper/10 hover:text-paper transition-colors disabled:opacity-40"
          >
            {generating ? "✨…" : "✨ Generate"}
          </button>
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
            spellCheck
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
