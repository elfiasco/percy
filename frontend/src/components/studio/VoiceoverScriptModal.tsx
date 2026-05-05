import { useState } from "react"
import { generateVoiceoverScript } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

const STYLES = [
  { id: "professional",   label: "Professional",   desc: "Clear business narration" },
  { id: "conversational", label: "Conversational", desc: "Warm, approachable tone" },
  { id: "formal",         label: "Formal",         desc: "Executive / authoritative" },
  { id: "energetic",      label: "Energetic",       desc: "Enthusiastic & engaging" },
]

export default function VoiceoverScriptModal({ docId, onClose }: Props) {
  const [style, setStyle]             = useState("professional")
  const [wpm, setWpm]                 = useState(130)
  const [includeNotes, setIncludeNotes] = useState(true)
  const [loading, setLoading]         = useState(false)
  const [script, setScript]           = useState("")
  const [meta, setMeta]               = useState<{ slide_count: number; word_count: number; estimated_minutes: number } | null>(null)
  const [error, setError]             = useState("")
  const [copied, setCopied]           = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    setError("")
    setScript("")
    setMeta(null)
    try {
      const r = await generateVoiceoverScript(docId, style, wpm, includeNotes)
      setScript(r.script)
      setMeta({ slide_count: r.slide_count, word_count: r.word_count, estimated_minutes: r.estimated_minutes })
    } catch {
      setError("Failed to generate script — check that the backend is running and ANTHROPIC_API_KEY is set.")
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleDownload = () => {
    const blob = new Blob([script], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "voiceover-script.txt"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[660px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">AI Voiceover Script</h2>
            <p className="text-white/40 text-xs mt-0.5">Generate a complete narration script for your presentation</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {!script && (
            <>
              {/* style picker */}
              <div>
                <p className="text-white/50 text-xs mb-2">Speaking style</p>
                <div className="grid grid-cols-2 gap-2">
                  {STYLES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setStyle(s.id)}
                      className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${style === s.id ? "border-accent/50 bg-accent/10 text-white" : "border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/8"}`}
                    >
                      <div className="font-medium text-[13px]">{s.label}</div>
                      <div className="text-[11px] text-white/40 mt-0.5">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* WPM + notes */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-white/50 text-xs">Speaking pace:</span>
                  <input
                    type="number"
                    min={80} max={200}
                    value={wpm}
                    onChange={(e) => setWpm(Math.max(80, Math.min(200, parseInt(e.target.value) || 130)))}
                    className="w-14 text-center bg-white/5 border border-white/15 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-accent/50"
                  />
                  <span className="text-white/30 text-xs">words/min</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeNotes}
                    onChange={(e) => setIncludeNotes(e.target.checked)}
                    className="accent-accent"
                  />
                  <span className="text-white/50 text-xs">Include speaker notes as context</span>
                </label>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-40 transition-colors"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">✦</span> Generating script…
                  </span>
                ) : "Generate Voiceover Script"}
              </button>
            </>
          )}

          {script && meta && (
            <>
              {/* meta strip */}
              <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5">
                <div className="flex-1 text-white/50 text-xs">{meta.slide_count} slides · {meta.word_count.toLocaleString()} words · ~{meta.estimated_minutes} min</div>
                <button
                  onClick={handleCopy}
                  className="text-xs px-2.5 py-1 rounded border border-white/15 text-white/60 hover:text-white hover:bg-white/8 transition-colors"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
                <button
                  onClick={handleDownload}
                  className="text-xs px-2.5 py-1 rounded border border-white/15 text-white/60 hover:text-white hover:bg-white/8 transition-colors"
                >
                  Download .txt
                </button>
                <button
                  onClick={() => { setScript(""); setMeta(null) }}
                  className="text-xs px-2.5 py-1 rounded border border-white/15 text-white/40 hover:text-white/70 hover:bg-white/8 transition-colors"
                >
                  Regenerate
                </button>
              </div>

              {/* script content */}
              <pre className="whitespace-pre-wrap text-white/70 text-xs font-mono leading-relaxed bg-black/30 border border-white/10 rounded-lg p-4 max-h-[50vh] overflow-y-auto">
                {script}
              </pre>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
