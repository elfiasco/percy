import { useState } from "react"
import { fetchSocialSnippets } from "../../lib/studioApi"
import type { SocialPost } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

type Platform = "linkedin" | "twitter" | "both"

const LIMIT: Record<string, number> = { linkedin: 3000, twitter: 280 }

export default function SocialSnippetsModal({ docId, onClose }: Props) {
  const [loading, setLoading]   = useState(false)
  const [platform, setPlatform] = useState<Platform>("linkedin")
  const [posts, setPosts]       = useState<SocialPost[] | null>(null)
  const [error, setError]       = useState("")
  const [copied, setCopied]     = useState<number | null>(null)

  const run = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetchSocialSnippets(docId, platform)
      setPosts(res.posts)
    } catch {
      setError("Failed to generate social snippets")
    } finally {
      setLoading(false)
    }
  }

  const copy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopied(idx)
    setTimeout(() => setCopied(null), 1500)
  }

  const charColor = (len: number, plat: string) => {
    const lim = LIMIT[plat] ?? 3000
    if (len > lim) return "text-red-400"
    if (len > lim * 0.85) return "text-yellow-400"
    return "text-white/30"
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Social Snippets</h2>
            <p className="text-white/40 text-xs mt-0.5">Generate shareable posts from your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-2">
            {(["linkedin", "twitter", "both"] as Platform[]).map((p) => (
              <button key={p} onClick={() => setPlatform(p)}
                className={`px-3 py-1 rounded text-xs border capitalize transition-colors ${platform === p ? "bg-accent/15 border-accent/30 text-accent" : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"}`}
              >{p === "twitter" ? "X / Twitter" : p}</button>
            ))}
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-2">
              <div className="animate-spin text-2xl">✦</div>
              <p className="text-sm">Generating posts…</p>
            </div>
          )}

          {posts !== null && !loading && (
            <div className="space-y-3">
              {posts.map((p, i) => (
                <div key={i} className="bg-white/3 border border-white/8 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/30 uppercase tracking-wide">{p.platform}</span>
                    <span className={`text-[10px] ml-auto font-mono ${charColor(p.text.length, p.platform)}`}>{p.text.length}{LIMIT[p.platform] ? `/${LIMIT[p.platform]}` : ""}</span>
                    <button onClick={() => copy(p.text, i)}
                      className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition-colors">
                      {copied === i ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="text-white/70 text-xs leading-relaxed whitespace-pre-wrap">{p.text}</p>
                  {p.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.hashtags.map((h, j) => (
                        <span key={j} className="text-[10px] text-accent/50 bg-accent/8 px-1.5 py-0.5 rounded">{h}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {posts === null && !loading && (
            <div className="text-white/30 text-sm text-center py-8">Select a platform and click "Generate".</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-between">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
          <button onClick={run} disabled={loading}
            className="text-sm px-5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors">
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  )
}
