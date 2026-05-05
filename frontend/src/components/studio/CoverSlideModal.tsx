import { useState } from "react"
import { generateCoverSlide } from "../../lib/studioApi"

interface Props {
  docId: string
  docName: string
  onClose: () => void
  onCreated: (slideCount: number) => void
}

type Style = "dark" | "light" | "accent"

const STYLES: { key: Style; label: string; preview: { bg: string; title: string; sub: string } }[] = [
  { key: "dark",   label: "Dark",   preview: { bg: "#0A0E1A", title: "#FFFFFF", sub: "#A5B4FC" } },
  { key: "light",  label: "Light",  preview: { bg: "#FFFFFF", title: "#0F172A", sub: "#4F46E5" } },
  { key: "accent", label: "Accent", preview: { bg: "#4F46E5", title: "#FFFFFF", sub: "#C7D2FE" } },
]

export default function CoverSlideModal({ docId, docName, onClose, onCreated }: Props) {
  const [title, setTitle]     = useState(docName)
  const [subtitle, setSubtitle] = useState("")
  const [author, setAuthor]   = useState("")
  const [date, setDate]       = useState("")
  const [style, setStyle]     = useState<Style>("dark")
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState("")

  const create = async () => {
    if (!title.trim()) { setError("Title is required"); return }
    setLoading(true)
    setError("")
    try {
      const r = await generateCoverSlide(docId, title.trim(), subtitle.trim(), author.trim(), date.trim(), style)
      onCreated(r.slide_count)
      onClose()
    } catch {
      setError("Failed to create cover slide")
    } finally {
      setLoading(false)
    }
  }

  const sel = STYLES.find((s) => s.key === style)!

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[520px] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Generate Cover Slide</h2>
            <p className="text-white/40 text-xs mt-0.5">Creates a professional title slide at position 1</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* style picker */}
          <div className="space-y-2">
            <label className="text-white/60 text-xs font-medium">Style</label>
            <div className="flex gap-2">
              {STYLES.map((st) => (
                <button
                  key={st.key}
                  onClick={() => setStyle(st.key)}
                  className={`flex-1 rounded-lg border overflow-hidden transition-all ${style === st.key ? "ring-2 ring-accent ring-offset-1 ring-offset-[#1e1e2e]" : "border-white/10 hover:border-white/20"}`}
                >
                  <div
                    className="h-14 flex flex-col justify-center px-3"
                    style={{ backgroundColor: st.preview.bg }}
                  >
                    <div className="h-1.5 rounded-full w-2/3 mb-1" style={{ backgroundColor: st.preview.title }} />
                    <div className="h-1 rounded-full w-1/2" style={{ backgroundColor: st.preview.sub }} />
                  </div>
                  <div className="bg-white/5 py-1 text-center">
                    <span className={`text-xs ${style === st.key ? "text-accent" : "text-white/40"}`}>{st.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* fields */}
          <div className="space-y-3">
            <div>
              <label className="text-white/60 text-xs font-medium block mb-1">Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Presentation Title"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="text-white/60 text-xs font-medium block mb-1">Subtitle</label>
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Optional subtitle"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-white/60 text-xs font-medium block mb-1">Author</label>
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Your name"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label className="text-white/60 text-xs font-medium block mb-1">Date</label>
                <input
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  placeholder="e.g. June 2025"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-accent/50"
                />
              </div>
            </div>
          </div>

          {/* mini preview */}
          <div
            className="relative rounded-lg overflow-hidden h-20"
            style={{ backgroundColor: sel.preview.bg }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: "#6366F1" }} />
            <div className="pl-4 pt-4">
              <div className="text-sm font-bold truncate" style={{ color: sel.preview.title }}>{title || "Presentation Title"}</div>
              {subtitle && <div className="text-xs mt-0.5 truncate" style={{ color: sel.preview.sub }}>{subtitle}</div>}
              {(author || date) && (
                <div className="text-[10px] absolute bottom-2 left-4" style={{ color: "#64748B" }}>
                  {[author, date].filter(Boolean).join("  ·  ")}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Cancel</button>
          <button
            onClick={create}
            disabled={loading || !title.trim()}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? "Creating…" : "Insert Cover Slide"}
          </button>
        </div>
      </div>
    </div>
  )
}
