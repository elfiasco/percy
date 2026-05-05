import { useState } from "react"
import { fetchAudiencePersonaBuilder } from "../../lib/studioApi"
import type { AudiencePersona } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function AudiencePersonaBuilderModal({ docId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AudiencePersona | null>(null)
  const [error, setError] = useState("")

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchAudiencePersonaBuilder(docId)
      setData(res)
    } catch {
      setError("Failed to build audience persona")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Audience Persona Builder</h2>
            <p className="text-white/40 text-xs mt-0.5">AI infers the likely target audience from your content</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Building persona…</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-4">
              <div className="bg-accent/5 border border-accent/15 rounded-lg px-4 py-3">
                <p className="text-white/80 font-semibold text-sm">{data.persona_name}</p>
                <div className="flex gap-3 mt-1 text-[10px] text-white/40">
                  <span>{data.role}</span>
                  <span>·</span>
                  <span>{data.industry}</span>
                  <span>·</span>
                  <span>{data.seniority}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Knowledge Level</p>
                  <p className="text-[11px] text-white/60">{data.knowledge_level}</p>
                </div>
                <div className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Comm Style</p>
                  <p className="text-[11px] text-white/60">{data.communication_style}</p>
                </div>
              </div>

              {data.main_concerns.length > 0 && (
                <div className="bg-red-400/5 border border-red-400/15 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] text-red-400/60 uppercase tracking-wider">Main Concerns</p>
                  {data.main_concerns.map((c, i) => (
                    <p key={i} className="text-[11px] text-white/60 leading-relaxed">· {c}</p>
                  ))}
                </div>
              )}

              {data.key_motivations.length > 0 && (
                <div className="bg-green-400/5 border border-green-400/15 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] text-green-400/60 uppercase tracking-wider">Key Motivations</p>
                  {data.key_motivations.map((m, i) => (
                    <p key={i} className="text-[11px] text-white/60 leading-relaxed">· {m}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {data === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Click "Build" to generate the audience persona.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Building…" : "Build"}
          </button>
        </div>
      </div>
    </div>
  )
}
