import { useState, useEffect, useCallback, useRef } from "react"
import Editor from "@monaco-editor/react"
import type { StudioElement } from "../../lib/studioTypes"
import {
  fetchElementConnect, updateElementConnect, testElementConnect,
  type ConnectTestResult,
} from "../../lib/studioApi"

const STARTER_SCRIPT = `# Each element has a Connect — a Python script that can read or transform it.
# The script returns a value (or a dict of patches) when called via the Tester.
#
# Available globals:
#   element  — the full Bridge element JSON (read-only here, but you can return mutations)
#   inputs   — test inputs you set in the right pane
#
# Use \`return\` to send a value back. Anything you \`print(...)\` shows in stdout.

def main():
    name = element.get("identification", {}).get("shape_name", element.get("type"))
    print(f"Hello from {name}!")
    return {"name": name, "kind": element.get("type")}

return main()
`

interface Props {
  docId: string
  slideN: number
  element: StudioElement
  onClose: () => void
}

type RightTab = "test" | "ai"

interface ChatMsg { role: "user" | "assistant"; content: string; ts: number }

export default function ConnectModal({ docId, slideN, element, onClose }: Props) {
  const [tab, setTab]               = useState<RightTab>("test")
  const [script, setScript]         = useState<string>("")
  const [inputsText, setInputsText] = useState<string>("{}")
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [running, setRunning]       = useState(false)
  const [savedAt, setSavedAt]       = useState<number>(0)
  const [result, setResult]         = useState<ConnectTestResult | null>(null)

  // ── load existing script ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchElementConnect(docId, slideN, element.id)
      .then((c) => {
        if (cancelled) return
        setScript(c.script || STARTER_SCRIPT)
        setInputsText(JSON.stringify(c.inputs || {}, null, 2))
        setSavedAt(c.updated_at || 0)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [docId, slideN, element.id])

  // ── save (debounced) ─────────────────────────────────────────────────────
  const saveTimer = useRef<number | null>(null)
  const queueSave = useCallback((nextScript: string, nextInputsText: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      setSaving(true)
      let inputs: Record<string, unknown> = {}
      try { inputs = JSON.parse(nextInputsText || "{}") } catch { /* keep last good */ }
      try {
        const c = await updateElementConnect(docId, slideN, element.id, { script: nextScript, inputs })
        setSavedAt(c.updated_at || Date.now() / 1000)
      } catch (e) {
        console.error("connect save failed:", e)
      } finally { setSaving(false) }
    }, 600)
  }, [docId, slideN, element.id])

  const handleScriptChange = useCallback((v: string | undefined) => {
    const s = v ?? ""
    setScript(s)
    queueSave(s, inputsText)
  }, [inputsText, queueSave])

  const handleInputsChange = useCallback((v: string) => {
    setInputsText(v)
    queueSave(script, v)
  }, [script, queueSave])

  // ── test run ──────────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    setRunning(true); setResult(null)
    let inputs: Record<string, unknown> = {}
    try { inputs = JSON.parse(inputsText || "{}") } catch (e) {
      setResult({ ok: false, result: null, error: `Invalid JSON in inputs: ${e instanceof Error ? e.message : e}`, traceback: null, stdout: "", stderr: "" })
      setRunning(false); return
    }
    try {
      const r = await testElementConnect(docId, slideN, element.id, { script, inputs })
      setResult(r)
    } catch (e) {
      setResult({ ok: false, result: null, error: e instanceof Error ? e.message : String(e), traceback: null, stdout: "", stderr: "" })
    } finally { setRunning(false) }
  }, [docId, slideN, element.id, script, inputsText])

  // Cmd/Ctrl+Enter triggers test run anywhere in the modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault()
        handleRun()
      } else if (e.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleRun, onClose])

  return (
    <div className="fixed inset-0 z-[1000] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-[1100px] max-w-[98vw] h-[78vh] bg-surface border border-edge rounded-lg shadow-2xl flex flex-col"
        style={{ background: "rgb(var(--surface))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-edge">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-md bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-sm">⚙</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-200 truncate">Edit Connect — {element.name}</div>
              <div className="text-[10px] text-muted">{element.type} · slide {slideN}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted">
              {saving ? "saving…" : savedAt > 0 ? `saved ${new Date(savedAt * 1000).toLocaleTimeString()}` : ""}
            </span>
            <button onClick={onClose} className="text-muted hover:text-slate-200 text-lg w-7 h-7 rounded hover:bg-white/10">×</button>
          </div>
        </div>

        {error && (
          <div className="m-3 text-xs text-bad bg-bad/10 border border-bad/30 rounded px-3 py-2">{error}</div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">Loading connect…</div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* ── left: Monaco editor ─────────────────────────────────────── */}
            <div className="flex-1 min-w-0 flex flex-col border-r border-edge">
              <div className="h-8 shrink-0 flex items-center justify-between px-3 border-b border-edge bg-base">
                <span className="text-[10px] uppercase tracking-widest text-muted">Python · connect.py</span>
                <span className="text-[10px] text-muted/60">⌘/Ctrl+Enter to run</span>
              </div>
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  defaultLanguage="python"
                  theme="vs-dark"
                  value={script}
                  onChange={handleScriptChange}
                  options={{
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    tabSize: 4,
                    wordWrap: "on",
                    automaticLayout: true,
                  }}
                />
              </div>
            </div>

            {/* ── right: Tester + AI Assistant tabs ───────────────────────── */}
            <div className="w-[420px] shrink-0 flex flex-col bg-surface">
              <div className="flex shrink-0 border-b border-edge px-3 pt-1.5 gap-0.5 bg-base">
                {(["test", "ai"] as RightTab[]).map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className={[
                      "px-3 py-1 text-[10px] uppercase tracking-widest rounded-t transition-colors",
                      tab === t ? "bg-surface text-slate-200 border-t border-l border-r border-edge" : "text-muted hover:text-slate-300",
                    ].join(" ")}>
                    {t === "test" ? "Tester" : "AI Assistant"}
                  </button>
                ))}
              </div>

              {tab === "test" && (
                <TesterPane
                  inputsText={inputsText}
                  onInputsChange={handleInputsChange}
                  result={result}
                  running={running}
                  onRun={handleRun}
                />
              )}
              {tab === "ai" && (
                <AssistantPane
                  docId={docId}
                  slideN={slideN}
                  element={element}
                  script={script}
                  onApplySnippet={(s) => { setScript((prev) => prev + "\n\n" + s); queueSave(script + "\n\n" + s, inputsText) }}
                />
              )}
            </div>
          </div>
        )}

        {/* footer */}
        <div className="h-9 shrink-0 flex items-center justify-end px-4 border-t border-edge gap-2 bg-base">
          <button onClick={onClose}
            className="text-xs px-3 py-1 rounded text-muted hover:text-slate-200 border border-edge hover:bg-white/10">
            Close
          </button>
          <button onClick={handleRun} disabled={running}
            className="text-xs px-3 py-1 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-50">
            {running ? "Running…" : "Run (⌘/Ctrl+↵)"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tester pane ───────────────────────────────────────────────────────────────

function TesterPane({
  inputsText, onInputsChange, result, running, onRun,
}: {
  inputsText: string
  onInputsChange: (v: string) => void
  result: ConnectTestResult | null
  running: boolean
  onRun: () => void
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-2 border-b border-edge">
        <div className="text-[10px] uppercase tracking-widest text-muted mb-1">Test Inputs (JSON)</div>
        <textarea
          value={inputsText}
          onChange={(e) => onInputsChange(e.target.value)}
          rows={4}
          className="w-full text-[11px] font-mono bg-base border border-edge rounded p-2 text-slate-200 focus:outline-none focus:border-accent resize-none"
        />
        <button
          onClick={onRun}
          disabled={running}
          className="mt-2 w-full text-[11px] py-1.5 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-50"
        >{running ? "Running…" : "▶ Run"}</button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 scrollbar-thin">
        {!result && !running && (
          <div className="text-[11px] text-muted/60 italic text-center mt-6">
            No run yet. Click ▶ Run to test.
          </div>
        )}
        {running && (
          <div className="text-[11px] text-muted text-center mt-6 flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:300ms]" />
          </div>
        )}
        {result && (
          <>
            <div className={[
              "text-[10px] uppercase tracking-widest px-2 py-1 rounded",
              result.ok ? "bg-good/15 text-good border border-good/30" : "bg-bad/15 text-bad border border-bad/30",
            ].join(" ")}>
              {result.ok ? "Success" : "Failed"}
            </div>

            {result.error && (
              <Section title="Error" tone="bad">
                <pre className="text-[11px] font-mono text-bad whitespace-pre-wrap break-words">{result.error}</pre>
                {result.traceback && (
                  <pre className="text-[10px] font-mono text-muted/80 mt-1 whitespace-pre-wrap break-words">{result.traceback}</pre>
                )}
              </Section>
            )}
            {result.result !== null && result.result !== undefined && (
              <Section title="Return value">
                <pre className="text-[11px] font-mono text-slate-200 whitespace-pre-wrap break-words">{JSON.stringify(result.result, null, 2)}</pre>
              </Section>
            )}
            {result.stdout && (
              <Section title="stdout">
                <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-words">{result.stdout}</pre>
              </Section>
            )}
            {result.stderr && (
              <Section title="stderr" tone="warn">
                <pre className="text-[11px] font-mono text-amber-300/90 whitespace-pre-wrap break-words">{result.stderr}</pre>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, tone, children }: { title: string; tone?: "bad" | "warn"; children: React.ReactNode }) {
  const cls = tone === "bad" ? "border-bad/30 bg-bad/5" : tone === "warn" ? "border-amber-500/30 bg-amber-500/5" : "border-edge bg-base/40"
  return (
    <div className={`border ${cls} rounded p-2`}>
      <div className="text-[9px] uppercase tracking-widest text-muted mb-1">{title}</div>
      {children}
    </div>
  )
}

// ── AI Assistant pane ────────────────────────────────────────────────────────

function AssistantPane({
  docId, slideN, element, script, onApplySnippet,
}: {
  docId: string
  slideN: number
  element: StudioElement
  script: string
  onApplySnippet: (snippet: string) => void
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput]       = useState("")
  const [thinking, setThinking] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, thinking])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || thinking) return
    const userMsg: ChatMsg = { role: "user", content: text, ts: Date.now() }
    setMessages((prev) => [...prev, userMsg])
    setInput(""); setError(null); setThinking(true)

    // Prepend a system-style hint into the conversation (the chat endpoint
    // already accepts user/assistant turns; we use the first user turn to set
    // context about what we're editing).
    const contextPrelude = `I'm editing the Python "connect" script for a ${element.type} (id=${element.id}) on slide ${slideN}. Help me write or improve it. Show short, runnable Python snippets in fenced code blocks. The script has access to a global \`element\` (a JSON dict from the Bridge model) and \`inputs\` (a dict of test args), and should \`return\` a value or dict.\n\nCurrent script:\n\`\`\`python\n${script}\n\`\`\`\n\n${text}`

    try {
      const res = await fetch(`/api/docs/${docId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          slide_n:    slideN,
          element_id: element.id,
          messages:   [...messages, { role: "user", content: contextPrelude }].map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        throw new Error(`${res.status} ${t}`)
      }
      const data = await res.json()
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply, ts: Date.now() }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setThinking(false) }
  }, [input, thinking, docId, slideN, element, script, messages])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 scrollbar-thin">
        {messages.length === 0 && !thinking && (
          <div className="text-[11px] text-muted/60 leading-relaxed mt-4">
            <p className="text-center">Ask the assistant to help write or improve this connect script.</p>
            <ul className="text-[10px] mt-2 space-y-1 px-1">
              {[
                "Write a script that returns the element's bounding box",
                "Add error handling for missing fields",
                "Show me how to read text content from a BridgeText",
              ].map((s) => (
                <li key={s} className="px-2 py-1 rounded hover:bg-white/5 cursor-pointer text-muted/70 hover:text-slate-300"
                    onClick={() => setInput(s)}>"{s}"</li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <AssistantMessage key={m.ts} msg={m} onApplySnippet={onApplySnippet} />
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
          <div className="text-[10px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1">{error}</div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="shrink-0 border-t border-edge p-2">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Ask for help with this script…"
            rows={2}
            disabled={thinking}
            className="flex-1 resize-none text-[11px] bg-base border border-edge rounded px-2 py-1.5
                       text-slate-200 placeholder:text-muted/50 focus:outline-none focus:border-accent
                       disabled:opacity-50"
          />
          <button onClick={send} disabled={!input.trim() || thinking}
            className="shrink-0 px-3 py-1.5 rounded text-[11px] font-medium bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30 disabled:opacity-40">
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function AssistantMessage({ msg, onApplySnippet }: {
  msg: ChatMsg
  onApplySnippet: (snippet: string) => void
}) {
  // Extract fenced ```python``` blocks and render an "Apply" button next to each.
  const blocks = extractCodeBlocks(msg.content)
  return (
    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[95%] rounded-lg px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
        msg.role === "user"
          ? "bg-accent/20 text-slate-200 rounded-br-sm"
          : "bg-surface border border-edge text-slate-300 rounded-bl-sm"
      }`}>
        {blocks.length === 0 ? (
          <span>{msg.content}</span>
        ) : (
          blocks.map((b, i) => (
            <div key={i}>
              {b.kind === "text" ? (
                <span>{b.value}</span>
              ) : (
                <div className="my-1.5 bg-base/80 border border-edge rounded">
                  <div className="flex items-center justify-between px-2 py-0.5 text-[9px] uppercase tracking-widest text-muted/70 border-b border-edge/60">
                    <span>{b.lang || "python"}</span>
                    <button onClick={() => onApplySnippet(b.value)}
                      className="text-accent hover:text-accent-light">↑ append to editor</button>
                  </div>
                  <pre className="text-[11px] font-mono text-slate-200 p-2 overflow-x-auto">{b.value}</pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function extractCodeBlocks(text: string): Array<{ kind: "text" | "code"; value: string; lang?: string }> {
  const blocks: Array<{ kind: "text" | "code"; value: string; lang?: string }> = []
  const re = /```(\w*)\n([\s\S]*?)```/g
  let lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) blocks.push({ kind: "text", value: text.slice(lastIdx, m.index) })
    blocks.push({ kind: "code", value: m[2], lang: m[1] || "" })
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) blocks.push({ kind: "text", value: text.slice(lastIdx) })
  return blocks
}
