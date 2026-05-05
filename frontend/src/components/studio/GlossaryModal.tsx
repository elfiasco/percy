import { useState } from "react"
import { extractGlossary } from "../../lib/studioApi"
import type { GlossaryTerm } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
  onSlideInserted: () => void
}

export default function GlossaryModal({ docId, onClose, onSlideInserted }: Props) {
  const [loading, setLoading]     = useState(false)
  const [terms, setTerms]         = useState<GlossaryTerm[] | null>(null)
  const [error, setError]         = useState("")
  const [inserted, setInserted]   = useState(false)
  const [expanded, setExpanded]   = useState<number | null>(null)

  const extract = async (insert = false) => {
    setLoading(true)
    setError("")
    try {
      const r = await extractGlossary(docId, insert)
      setTerms(r.terms)
      if (insert && r.inserted_slide !== null) {
        setInserted(true)
        onSlideInserted()
      }
    } catch {
      setError(insert ? "Failed to insert glossary slide" : "Failed to extract glossary")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Glossary Extractor</h2>
            <p className="text-white/40 text-xs mt-0.5">AI finds domain terms and can insert a definitions slide</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {inserted && (
            <div className="text-green-400 text-xs bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
              Glossary slide appended to the end of the deck.
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Extracting terms…</p>
            </div>
          )}

          {terms !== null && !loading && (
            terms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <p className="text-white/50 text-sm">No domain-specific terms found.</p>
              </div>
            ) : (
              <>
                <div className="text-white/40 text-xs">
                  Found <span className="text-white/70 font-medium">{terms.length}</span> term{terms.length !== 1 ? "s" : ""}
                </div>
                <div className="space-y-1.5">
                  {terms.map((t, i) => (
                    <div key={i} className="rounded-lg border border-white/10 overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-3 py-2 bg-white/3 hover:bg-white/6 text-left"
                        onClick={() => setExpanded(expanded === i ? null : i)}
                      >
                        <span className="text-white/80 text-xs font-medium">{t.term}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-white/25 text-[10px]">first seen slide {t.slide_first_seen}</span>
                          <span className="text-white/30 text-xs">{expanded === i ? "▲" : "▼"}</span>
                        </div>
                      </button>
                      {expanded === i && (
                        <div className="px-3 py-2 bg-white/2 border-t border-white/8">
                          <p className="text-white/55 text-xs leading-relaxed">{t.definition}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )
          )}

          {terms === null && !loading && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-white/30">
              <p className="text-sm">Click "Extract Terms" to identify domain vocabulary in your deck.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <div className="flex gap-2">
            <button
              onClick={() => extract(false)}
              disabled={loading}
              className="text-sm px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/60 hover:text-white/90 disabled:opacity-40 transition-colors"
            >
              Extract Terms
            </button>
            {terms && terms.length > 0 && !inserted && (
              <button
                onClick={() => extract(true)}
                disabled={loading}
                className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
              >
                Insert Glossary Slide
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
