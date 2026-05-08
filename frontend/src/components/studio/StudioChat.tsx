import { useState, useRef, useEffect, useCallback } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import { agentChat, type AgentChatResponse } from "../../lib/agentApi"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  ts: number
  meta?: {
    mode?: string
    actions_taken?: number
    ok?: boolean
    error?: string | null
    needs_clarification?: boolean
  }
}

interface Props {
  docId: string
  slideN: number
  selectedElement: StudioElement | null
  onClose: () => void
  onRefresh?: () => void
}

const MODE_LABELS: Record<string, string> = {
  static_plan:   "editor",
  iterative_plan: "iterative",
  scripted_plan:  "coder",
}

export default function StudioChat({ docId, slideN, selectedElement, onClose, onRefresh }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput]       = useState("")
  const [thinking, setThinking] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const clearChat = useCallback(() => {
    setMessages([])
    setError(null)
    setInput("")
  }, [])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, thinking])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || thinking) return

    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput("")
    setError(null)
    setThinking(true)

    try {
      const resp: AgentChatResponse = await agentChat(
        docId,
        history.map((m) => ({ role: m.role, content: m.content })),
        {
          viewing_slide_n:     slideN,
          selected_element_id: selectedElement?.id ?? null,
        },
      )
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: resp.reply,
          ts: Date.now(),
          meta: {
            mode:               resp.mode,
            actions_taken:      resp.actions_taken,
            ok:                 resp.execution?.ok,
            error:              resp.execution?.error,
            needs_clarification: resp.needs_clarification,
          },
        },
      ])
      if ((resp.actions_taken ?? 0) > 0) onRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setThinking(false)
    }
  }, [input, thinking, docId, slideN, selectedElement, messages, onRefresh])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="flex flex-col h-full border-l border-edge bg-surface min-w-0 w-72 shrink-0">
      {/* header */}
      <div className="h-10 shrink-0 flex items-center justify-between px-3 border-b border-edge">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-accent uppercase tracking-widest">AI Chat</span>
          <span className="text-[10px] text-muted">Percy Agent</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={clearChat}
            title="Clear conversation"
            className="text-muted hover:text-slate-200 transition-colors text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            title="Close chat"
            className="text-muted hover:text-slate-200 transition-colors text-sm w-6 h-6 flex items-center justify-center rounded hover:bg-white/10"
          >
            ×
          </button>
        </div>
      </div>

      {/* context bar */}
      <div className="px-3 py-1.5 border-b border-edge bg-base/40 text-[10px] text-muted flex items-center gap-1.5 shrink-0">
        <span>Slide {slideN}</span>
        {selectedElement && (
          <>
            <span className="text-edge">·</span>
            <span className="text-accent-light truncate max-w-[10rem]" title={selectedElement.name}>
              {selectedElement.label}: {selectedElement.name}
            </span>
          </>
        )}
        {!selectedElement && <span className="text-edge italic">no element selected</span>}
      </div>

      {/* messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 && !thinking && (
          <div className="text-[11px] text-muted/60 mt-4 leading-relaxed space-y-2">
            <p className="text-center">Ask Percy to edit your presentation.</p>
            <ul className="text-[10px] space-y-1 list-none px-1">
              {[
                "Change the text of this element",
                "Make the fill color blue",
                "Insert a red rectangle at the top",
                "Move this element to the center",
                "Set the slide background to #1a1a2e",
                "Add a bar chart of Q1–Q4 revenue",
                "For each row in the data, add a tile",
              ].map((hint) => (
                <li
                  key={hint}
                  className="cursor-pointer px-2 py-1 rounded hover:bg-white/5 transition-colors text-muted/70 hover:text-slate-300"
                  onClick={() => setInput(hint)}
                >
                  "{hint}"
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.ts}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === "user"
                  ? "bg-accent/20 text-slate-200 rounded-br-sm"
                  : "bg-surface border border-edge text-slate-300 rounded-bl-sm"
              }`}
            >
              {msg.content}
              {msg.meta && msg.role === "assistant" && (
                <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                  {msg.meta.mode && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent/70 border border-accent/20">
                      {MODE_LABELS[msg.meta.mode] ?? msg.meta.mode}
                    </span>
                  )}
                  {(msg.meta.actions_taken ?? 0) > 0 && !msg.meta.needs_clarification && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-good/10 text-good/80 border border-good/20">
                      {msg.meta.actions_taken} change{msg.meta.actions_taken !== 1 ? "s" : ""}
                    </span>
                  )}
                  {msg.meta.ok === false && msg.meta.error && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-bad/10 text-bad/80 border border-bad/20" title={msg.meta.error}>
                      failed
                    </span>
                  )}
                  {msg.meta.needs_clarification && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80 border border-amber-500/20">
                      needs info
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {thinking && (
          <div className="flex justify-start">
            <div className="bg-surface border border-edge rounded-lg rounded-bl-sm px-3 py-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {error && (
          <div className="text-[10px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* input area */}
      <div className="shrink-0 border-t border-edge p-2">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Percy… (Enter to send)"
            rows={2}
            disabled={thinking}
            className="flex-1 resize-none text-[11px] bg-base border border-edge rounded px-2 py-1.5
                       text-slate-200 placeholder:text-muted/50 focus:outline-none focus:border-accent
                       disabled:opacity-50 disabled:cursor-not-allowed min-h-0"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || thinking}
            className="shrink-0 px-3 py-1.5 rounded text-[11px] font-medium
                       bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30
                       transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
        <div className="mt-1 text-[9px] text-muted/40 text-center">
          Shift+Enter for new line
        </div>
      </div>
    </div>
  )
}
