import { executiveBriefingUrl } from "../../lib/studioApi"

interface Props {
  docId: string
  onClose: () => void
}

export default function ExecutiveBriefingModal({ docId, onClose }: Props) {
  const download = (fmt: "md" | "txt") => {
    const a = document.createElement("a")
    a.href = executiveBriefingUrl(docId, fmt)
    a.download = `executive-briefing.${fmt}`
    a.click()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1e1e2e] border border-white/10 rounded-xl shadow-2xl w-[440px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Executive Briefing</h2>
            <p className="text-white/40 text-xs mt-0.5">AI generates a one-page summary of your deck</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none w-7 h-7 flex items-center justify-center rounded">×</button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-white/50 text-xs leading-relaxed">
            AI reads all slide text and speaker notes to produce a concise executive summary — key takeaways, main arguments, and recommended actions — ready to paste into a memo or email.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => download("md")}
              className="flex-1 py-2 rounded-lg bg-accent/15 border border-accent/30 text-accent text-sm hover:bg-accent/25 transition-colors"
            >
              Download Markdown
            </button>
            <button
              onClick={() => download("txt")}
              className="flex-1 py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 text-sm hover:bg-white/10 transition-colors"
            >
              Download Plain Text
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end">
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white/80 px-4 py-1.5 rounded-md hover:bg-white/5 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
