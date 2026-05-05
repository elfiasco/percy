import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { StudioElement } from "../../lib/studioTypes"
import { listDocConnects, type DocConnectRow } from "../../lib/studioApi"
import {
  agentChat, applyTemplate, deleteMaterial, generateDeck, getSuggestions,
  listActions, listMaterials, listTemplates, rollbackAction, runBrandCheck,
  runRefresh, saveSlideAsTemplate, searchTemplates, setStarterFlag, uploadMaterial,
  type AgentAction, type AgentChatResponse, type AgentMaterial, type AgentPlan,
  type AgentSuggestion, type AgentTemplate, type BrandReport, type RefreshReport,
} from "../../lib/agentApi"

const COLLAPSED_KEY = "percy_agent_collapsed_v1"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  ts: number
  response?: AgentChatResponse
}

interface Props {
  docId: string
  slideN: number
  selectedElement: StudioElement | null
  collapsed: boolean
  onToggleCollapsed: (collapsed: boolean) => void
  onRefresh?: () => void
  onJumpToSlide?: (n: number) => void
  onEditConnect?: (elementId: string) => void
  refreshTick?: number
}

export const loadAgentCollapsed = (): boolean => localStorage.getItem(COLLAPSED_KEY) === "1"
export const saveAgentCollapsed = (c: boolean): void => { localStorage.setItem(COLLAPSED_KEY, c ? "1" : "0") }

type AgentTab = "chat" | "templates" | "materials" | "insights" | "connects" | "activity"

export default function StudioAgent({
  docId, slideN, selectedElement, collapsed, onToggleCollapsed, onRefresh,
  onJumpToSlide, onEditConnect, refreshTick,
}: Props) {
  const [tab, setTab]           = useState<AgentTab>("chat")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput]       = useState("")
  const [thinking, setThinking] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages, thinking])

  const totalActions = messages.reduce((acc, m) => acc + (m.response?.actions_taken ?? 0), 0)

  const clearChat = useCallback(() => { setMessages([]); setError(null); setInput("") }, [])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || thinking) return
    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() }
    setMessages((prev) => [...prev, userMsg])
    setInput(""); setError(null); setThinking(true)
    try {
      const resp = await agentChat(
        docId,
        [...messages.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: text }],
        {
          viewing_slide_n: slideN,
          selected_element_id: selectedElement?.id ?? null,
          user_confirmed: true,
        },
      )
      setMessages((prev) => [...prev, { role: "assistant", content: resp.reply, ts: Date.now(), response: resp }])
      if (resp.actions_taken > 0) onRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setThinking(false)
    }
  }, [input, thinking, docId, slideN, selectedElement, messages, onRefresh])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  if (collapsed) {
    return (
      <div className="w-9 shrink-0 border-l border-edge bg-surface flex flex-col items-center py-2 gap-2 select-none">
        <button
          onClick={() => onToggleCollapsed(false)}
          title="Open AI assistant"
          className="w-7 h-7 rounded-md bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 flex items-center justify-center text-base"
        >✦</button>
        <div className="text-[8px] text-muted [writing-mode:vertical-rl] tracking-widest uppercase mt-1">AI</div>
        {totalActions > 0 && (
          <div className="text-[9px] text-accent font-mono mt-1">{totalActions}</div>
        )}
      </div>
    )
  }

  return (
    <div className="w-96 shrink-0 border-l border-edge bg-surface flex flex-col min-w-0 select-none">
      {/* header */}
      <div className="h-10 shrink-0 flex items-center justify-between px-3 border-b border-edge">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-white/10 border border-white/20 flex items-center justify-center text-[11px] text-slate-100">✦</div>
          <span className="text-[10px] font-bold text-slate-100 uppercase tracking-widest">Assistant</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={clearChat} title="Clear conversation"
            className="text-muted hover:text-slate-200 transition-colors text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10">Clear</button>
          <button onClick={() => onToggleCollapsed(true)} title="Collapse"
            className="text-muted hover:text-slate-200 transition-colors text-sm w-6 h-6 flex items-center justify-center rounded hover:bg-white/10">→</button>
        </div>
      </div>

      {/* tab strip */}
      <div className="flex shrink-0 border-b border-edge bg-base/30 px-2 pt-1.5 gap-0.5 overflow-x-auto">
        {(["chat", "templates", "materials", "insights", "connects", "activity"] as AgentTab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={[
              "px-2 py-1 text-[10px] capitalize rounded-t transition-colors whitespace-nowrap",
              tab === t
                ? "bg-surface text-slate-200 border-t border-l border-r border-edge"
                : "text-muted hover:text-slate-300",
            ].join(" ")}>
            {t}{t === "activity" && totalActions > 0 ? ` ·${totalActions}` : ""}
          </button>
        ))}
      </div>

      {/* context bar */}
      <div className="px-3 py-1.5 border-b border-edge bg-base/40 text-[10px] text-muted flex items-center gap-1.5 shrink-0">
        <span>Slide {slideN}</span>
        {selectedElement ? (
          <>
            <span className="text-edge">·</span>
            <span className="text-accent-light truncate max-w-[10rem]" title={selectedElement.name}>
              {selectedElement.label}: {selectedElement.name}
            </span>
          </>
        ) : <span className="text-edge italic">no element selected</span>}
      </div>

      {tab === "chat" ? (
        <ChatView
          messages={messages} input={input} setInput={setInput} thinking={thinking} error={error}
          inputRef={inputRef} bottomRef={bottomRef} onSend={handleSend} onKeyDown={handleKeyDown}
        />
      ) : tab === "templates" ? (
        <TemplatesView docId={docId} slideN={slideN} onApplied={onRefresh} />
      ) : tab === "materials" ? (
        <MaterialsView docId={docId} />
      ) : tab === "insights" ? (
        <InsightsView docId={docId} onRefresh={onRefresh} />
      ) : tab === "connects" ? (
        <ConnectsView docId={docId} refreshTick={refreshTick}
          onJumpToSlide={onJumpToSlide} onEditConnect={onEditConnect} />
      ) : (
        <ActivityView docId={docId} onRefresh={onRefresh} refreshTick={refreshTick} totalActions={totalActions} />
      )}
    </div>
  )
}


// ── Chat view (with plan cards) ─────────────────────────────────────────────

function ChatView({
  messages, input, setInput, thinking, error, inputRef, bottomRef, onSend, onKeyDown,
}: {
  messages: ChatMessage[]
  input: string
  setInput: (s: string) => void
  thinking: boolean
  error: string | null
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  bottomRef: React.RefObject<HTMLDivElement | null>
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 scrollbar-thin">
        {messages.length === 0 && !thinking && (
          <div className="text-[11px] text-muted/60 mt-4 leading-relaxed space-y-2">
            <p className="text-center">Ask Percy to edit, create, or generate.</p>
            <ul className="text-[10px] space-y-1 list-none px-1">
              {[
                "Make the title bold and dark navy.",
                "Add a column chart of Q1-Q4 revenue: 100, 120, 130, 140.",
                "Create a timeline with one bar per day for the next 7 days.",
                "Apply the KPI tiles template to slide 2.",
                "Make every chart's title bold.",
              ].map((hint) => (
                <li key={hint}
                  className="cursor-pointer px-2 py-1 rounded hover:bg-white/5 transition-colors text-muted/70 hover:text-slate-300"
                  onClick={() => setInput(hint)}>"{hint}"</li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.ts}>
            <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === "user"
                  ? "bg-accent/20 text-slate-200 rounded-br-sm"
                  : "bg-surface border border-edge text-slate-300 rounded-bl-sm"
              }`}>
                {msg.content}
              </div>
            </div>
            {msg.response && msg.role === "assistant" && <PlanCard response={msg.response} />}
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
          <div className="text-[10px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1">{error}</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-edge p-2">
        <div className="flex gap-2 items-end">
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown} placeholder="Ask… (Enter to send)" rows={2} disabled={thinking}
            className="flex-1 resize-none text-[11px] bg-base border border-edge rounded px-2 py-1.5
                       text-slate-200 placeholder:text-muted/50 focus:outline-none focus:border-accent
                       disabled:opacity-50 disabled:cursor-not-allowed min-h-0" />
          <button onClick={onSend} disabled={!input.trim() || thinking}
            className="shrink-0 px-3 py-1.5 rounded text-[11px] font-medium
                       bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30
                       transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Send</button>
        </div>
        <div className="mt-1 text-[9px] text-muted/40 text-center">Shift+Enter for new line</div>
      </div>
    </>
  )
}


function PlanCard({ response }: { response: AgentChatResponse }) {
  const { mode, mode_method, mode_confidence, plan, execution, actions_taken } = response
  const modeColor =
    mode === "scripted_plan" ? "text-purple-400" :
    mode === "iterative_plan" ? "text-amber-400" :
    "text-accent"

  return (
    <div className="ml-2 mt-1.5 border-l-2 border-edge pl-2 text-[10px] space-y-1">
      <div className="flex items-center gap-2 text-muted/70">
        <span className={`font-mono ${modeColor}`}>{mode.replace("_plan", "")}</span>
        {mode_method && <span className="text-muted/50">via {mode_method}</span>}
        {mode_confidence != null && <span className="text-muted/50">{Math.round(mode_confidence * 100)}%</span>}
        {execution.ok ? (
          <span className="text-good">✓ {actions_taken} action{actions_taken === 1 ? "" : "s"}</span>
        ) : (
          <span className="text-bad">✗ failed</span>
        )}
      </div>
      {plan.rationale && <div className="text-muted/60 italic">{plan.rationale}</div>}
      {plan.calls && plan.calls.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {plan.calls.slice(0, 6).map((c, i) => {
            const step = execution.steps?.[i]
            return (
              <li key={i} className="font-mono text-[9px] text-muted/80 flex items-center gap-1.5">
                <span className={step?.ok ? "text-good" : step ? "text-bad" : "text-muted/50"}>
                  {step?.ok ? "✓" : step ? "✗" : "·"}
                </span>
                <span>{c.endpoint_id}</span>
                {step?.error && <span className="text-bad/70 truncate" title={step.error}>— {step.error}</span>}
              </li>
            )
          })}
          {plan.calls.length > 6 && <li className="text-muted/50">… {plan.calls.length - 6} more</li>}
        </ul>
      )}
      {plan.script && (
        <details className="mt-1">
          <summary className="cursor-pointer text-purple-400/70 hover:text-purple-300">
            View generated script ({plan.script.length} chars · {plan.script_kind})
          </summary>
          <pre className="mt-1 bg-base/50 p-1.5 rounded text-[9px] overflow-x-auto max-h-48 scrollbar-thin">
{plan.script}
          </pre>
        </details>
      )}
      {execution.error && <div className="text-bad/80">{execution.error}</div>}
    </div>
  )
}


// ── Templates view ──────────────────────────────────────────────────────────

function TemplatesView({ docId, slideN, onApplied }: { docId: string; slideN: number; onApplied?: () => void }) {
  const [templates, setTemplates] = useState<AgentTemplate[] | null>(null)
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AgentTemplate | null>(null)
  const [savePanel, setSavePanel] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    listTemplates()
      .then((r) => { if (!cancelled) setTemplates(r.templates) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [tick])

  const filtered = useMemo(() => {
    if (!templates) return []
    if (!search.trim()) return templates
    const q = search.trim().toLowerCase()
    return templates.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      (t.tags || []).some((tag) => tag.toLowerCase().includes(q)),
    )
  }, [templates, search])

  if (savePanel) {
    return <SaveTemplatePanel docId={docId} slideN={slideN}
      onClose={() => setSavePanel(false)}
      onSaved={() => { setSavePanel(false); setTick((t) => t + 1) }} />
  }

  if (selected) {
    return <ApplyTemplatePanel
      template={selected} docId={docId} slideN={slideN}
      onClose={() => setSelected(null)}
      onApplied={() => { setSelected(null); onApplied?.() }} />
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 scrollbar-thin">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-muted/80">
          <span className="text-accent">Percy Standard</span> templates are baked in.
        </div>
        <button onClick={() => setSavePanel(true)}
          className="text-[10px] px-1.5 py-0.5 rounded text-accent hover:bg-accent/10 border border-accent/40">
          + Save slide {slideN}
        </button>
      </div>
      <input
        type="text" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Search templates…"
        className="w-full text-[11px] bg-base border border-edge rounded px-2 py-1 mb-2
                   text-slate-200 placeholder:text-muted/50 focus:outline-none focus:border-accent" />
      {error && <div className="text-[10px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1">{error}</div>}
      {!templates ? (
        <div className="text-[11px] text-muted/60 italic">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-[11px] text-muted/70 italic">No templates match.</div>
      ) : (
        <ol className="space-y-1.5">
          {filtered.map((t) => (
            <li key={t.id}
              onClick={() => setSelected(t)}
              className="bg-base/40 border border-edge/60 rounded px-2 py-1.5 hover:border-accent/40 cursor-pointer">
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-slate-200 font-medium">{t.name}</span>
                {t.is_builtin && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-accent/20 text-accent border border-accent/30">STD</span>
                )}
              </div>
              <div className="text-[10px] text-muted/70 line-clamp-2">{t.description}</div>
              {t.tags && t.tags.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {t.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="text-[8px] text-muted/60 bg-white/5 rounded px-1">{tag}</span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function SaveTemplatePanel({
  docId, slideN, onClose, onSaved,
}: { docId: string; slideN: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(async () => {
    if (!name.trim()) return
    setSaving(true); setError(null)
    try {
      await saveSlideAsTemplate(docId, slideN, {
        name: name.trim(),
        description: description.trim() || undefined,
        tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [name, description, tags, docId, slideN, onSaved])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 scrollbar-thin">
      <button onClick={onClose} className="text-[10px] text-muted hover:text-slate-200 mb-2">← Back</button>
      <div className="font-medium text-[12px] text-slate-200 mb-1">Save slide {slideN} as template</div>
      <div className="text-[10px] text-muted/80 mb-3">
        Captures the current slide's elements, connect scripts, and slide script into a reusable template.
      </div>

      <label className="text-[10px] text-muted/80 block mb-0.5">Name <span className="text-bad/80">*</span></label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 Cover Slide"
        className="w-full text-[11px] bg-base border border-edge rounded px-2 py-1 mb-2 text-slate-200 placeholder:text-muted/50 focus:outline-none focus:border-accent" />

      <label className="text-[10px] text-muted/80 block mb-0.5">Description</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
        className="w-full text-[11px] bg-base border border-edge rounded px-2 py-1 mb-2 text-slate-200 placeholder:text-muted/50 focus:outline-none focus:border-accent" />

      <label className="text-[10px] text-muted/80 block mb-0.5">Tags (comma-separated)</label>
      <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="board, intro, header"
        className="w-full text-[11px] bg-base border border-edge rounded px-2 py-1 mb-3 text-slate-200 placeholder:text-muted/50 focus:outline-none focus:border-accent" />

      {error && <div className="text-[10px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1 mb-2">{error}</div>}

      <button onClick={save} disabled={!name.trim() || saving}
        className="w-full px-3 py-1.5 rounded text-[11px] font-medium
                   bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30
                   transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {saving ? "Saving…" : "Save as template"}
      </button>
    </div>
  )
}


function ApplyTemplatePanel({
  template, docId, slideN, onClose, onApplied,
}: {
  template: AgentTemplate
  docId: string
  slideN: number
  onClose: () => void
  onApplied: () => void
}) {
  const [inputs, setInputs] = useState<Record<string, unknown>>({ ...template.sample_inputs })
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requiredOk = useMemo(() => {
    return Object.entries(template.inputs_schema).every(([k, spec]) => {
      if (!spec.required) return true
      const v = inputs[k]
      return v != null && String(v).length > 0
    })
  }, [inputs, template.inputs_schema])

  const apply = useCallback(async () => {
    setApplying(true); setError(null)
    try {
      const result = await applyTemplate(template.id, docId, slideN, inputs)
      if (!result.ok) {
        setError(result.error || result.errors?.join("; ") || "apply failed")
      } else {
        onApplied()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }, [template.id, docId, slideN, inputs, onApplied])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 scrollbar-thin">
      <button onClick={onClose}
        className="text-[10px] text-muted hover:text-slate-200 mb-2">← Back</button>
      <div className="font-medium text-[12px] text-slate-200">{template.name}</div>
      <div className="text-[10px] text-muted/80 mb-3">{template.description}</div>

      <div className="text-[10px] text-accent mb-2 uppercase tracking-wider">Inputs</div>
      <div className="space-y-2 mb-3">
        {Object.entries(template.inputs_schema).map(([key, spec]) => (
          <div key={key}>
            <label className="text-[10px] text-muted/80 block mb-0.5">
              {key}
              {spec.required && <span className="text-bad/80 ml-0.5">*</span>}
              {spec.description && <span className="text-muted/50 ml-1.5 italic">— {spec.description}</span>}
            </label>
            <input
              type="text" value={String(inputs[key] ?? "")}
              onChange={(e) => setInputs((prev) => ({ ...prev, [key]: e.target.value }))}
              placeholder={spec.default != null ? String(spec.default) : ""}
              className="w-full text-[11px] bg-base border border-edge rounded px-2 py-1
                         text-slate-200 placeholder:text-muted/50 focus:outline-none focus:border-accent" />
          </div>
        ))}
      </div>

      <div className="text-[10px] text-accent mb-1 uppercase tracking-wider">Layout ({template.layout.length} elements)</div>
      <ul className="text-[10px] space-y-0.5 mb-3">
        {template.layout.map((entry, i) => (
          <li key={i} className="font-mono text-muted/70">
            {entry.kind}{entry.alias ? ` → ${entry.alias}` : ""}
          </li>
        ))}
      </ul>

      {error && <div className="text-[10px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1 mb-2">{error}</div>}

      <button onClick={apply} disabled={!requiredOk || applying}
        className="w-full px-3 py-1.5 rounded text-[11px] font-medium
                   bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30
                   transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {applying ? "Applying…" : `Apply to slide ${slideN}`}
      </button>
    </div>
  )
}


// ── Materials view ──────────────────────────────────────────────────────────

function MaterialsView({ docId }: { docId: string }) {
  const [materials, setMaterials] = useState<AgentMaterial[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [tick, setTick] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    listMaterials(docId)
      .then((r) => { if (!cancelled) setMaterials(r.materials) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [docId, tick])

  const onPickFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true); setError(null)
    try {
      const result = await uploadMaterial(docId, f)
      if (!result.ok) {
        setError(result.message || "upload rejected")
      }
      setTick((t) => t + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }, [docId])

  const onToggleStarter = useCallback(async (m: AgentMaterial) => {
    try {
      await setStarterFlag(docId, m.id, !m.usable_as_starter)
      setTick((t) => t + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [docId])

  const onDelete = useCallback(async (m: AgentMaterial) => {
    if (!confirm(`Delete '${m.filename}'?`)) return
    try {
      await deleteMaterial(docId, m.id)
      setTick((t) => t + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [docId])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 scrollbar-thin">
      <div className="text-[10px] text-muted/80 mb-2 leading-relaxed">
        Upload Python helpers, CSVs, or text files. Percy scans for secrets and indexes them
        so the coder skill can use your project's existing code as starters.
      </div>

      <input ref={fileRef} type="file" accept=".py,.csv,.txt,.md,.json"
        onChange={onPickFile} disabled={uploading}
        className="block w-full text-[10px] text-muted/80 mb-3
                   file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px]
                   file:bg-accent/20 file:text-accent file:hover:bg-accent/30 file:cursor-pointer
                   file:disabled:opacity-50" />

      {error && <div className="text-[10px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1 mb-2">{error}</div>}
      {uploading && <div className="text-[10px] text-muted italic">Uploading + scanning…</div>}

      {!materials ? (
        <div className="text-[11px] text-muted/60 italic">Loading…</div>
      ) : materials.length === 0 ? (
        <div className="text-[11px] text-muted/70 italic">No materials yet.</div>
      ) : (
        <ol className="space-y-1.5">
          {materials.map((m) => (
            <li key={m.id} className="bg-base/40 border border-edge/60 rounded px-2 py-1.5">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-slate-200 font-mono truncate" title={m.filename}>{m.filename}</span>
                <span className="text-[8px] text-muted/60 uppercase">{m.file_kind}</span>
              </div>
              <div className="text-[9px] text-muted/60 mb-1">
                {(m.file_size / 1024).toFixed(1)} KB · {m.chunk_count} chunks
                {!m.syntax_ok && <span className="text-bad ml-2">syntax error</span>}
                {m.dangerous_imports.length > 0 && (
                  <span className="text-warn ml-2" title={m.dangerous_imports.join(", ")}>
                    {m.dangerous_imports.length} flagged import{m.dangerous_imports.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1 text-[9px] text-muted/80 cursor-pointer">
                  <input type="checkbox" checked={m.usable_as_starter}
                    onChange={() => onToggleStarter(m)} className="w-3 h-3" />
                  use as starter (agent may copy from)
                </label>
                <button onClick={() => onDelete(m)}
                  className="text-[9px] text-bad/70 hover:text-bad">Delete</button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}


// ── Connects view (existing) ────────────────────────────────────────────────

function ConnectsView({
  docId, refreshTick, onJumpToSlide, onEditConnect,
}: {
  docId: string
  refreshTick?: number
  onJumpToSlide?: (n: number) => void
  onEditConnect?: (id: string) => void
}) {
  const [rows, setRows] = useState<DocConnectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listDocConnects(docId)
      .then((r) => { if (!cancelled) setRows(r.connects) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [docId, refreshTick])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 scrollbar-thin">
      <div className="text-[10px] text-muted/80 mb-3">
        Bridge elements with a Python connect attached. Click to jump to the slide.
      </div>
      {error && <div className="text-[10px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1">{error}</div>}
      {!rows ? (
        <div className="text-[11px] text-muted/60 italic">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-[11px] text-muted/70 italic">
          No connects yet. Right-click an element and choose <span className="text-accent">⚙ Edit Connect…</span>
        </div>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r) => (
            <li key={`${r.slide_n}:${r.element_id}`}
                className="bg-base/40 border border-edge/60 rounded px-2 py-1.5 hover:border-accent/40 group">
              <div className="flex items-center justify-between text-[10px] text-muted/70 mb-0.5">
                <span>Slide {r.slide_n} · {r.element_type.replace(/^Bridge/, "")}</span>
                <span className="font-mono">{r.script_chars}c</span>
              </div>
              <div className="text-[11px] text-slate-200 truncate">{r.element_name}</div>
              <div className="flex justify-end gap-1 mt-1">
                <button onClick={() => onJumpToSlide?.(r.slide_n)}
                  className="text-[10px] px-1.5 py-0.5 rounded text-slate-300 hover:text-white hover:bg-white/8 border border-edge">Jump →</button>
                <button onClick={() => { onJumpToSlide?.(r.slide_n); setTimeout(() => onEditConnect?.(r.element_id), 100) }}
                  className="text-[10px] px-1.5 py-0.5 rounded text-accent hover:bg-accent/10 border border-accent/40">Edit</button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}


// ── Insights view (brand check + suggestions + refresh + generate-deck) ────

function InsightsView({ docId, onRefresh }: { docId: string; onRefresh?: () => void }) {
  const [brandReport, setBrandReport]   = useState<BrandReport | null>(null)
  const [suggestions, setSuggestions]   = useState<AgentSuggestion[] | null>(null)
  const [refreshReport, setRefreshReport] = useState<RefreshReport | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [genPrompt, setGenPrompt] = useState("")

  const runBrand = useCallback(async () => {
    setBusy("brand"); setError(null)
    try {
      setBrandReport(await runBrandCheck(docId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [docId])

  const loadSuggestions = useCallback(async () => {
    setBusy("suggestions"); setError(null)
    try {
      const r = await getSuggestions(docId)
      setSuggestions(r.suggestions)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [docId])

  const refresh = useCallback(async () => {
    setBusy("refresh"); setError(null)
    try {
      const r = await runRefresh(docId, true)
      setRefreshReport(r)
      onRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [docId, onRefresh])

  const genDeck = useCallback(async () => {
    if (!genPrompt.trim()) return
    setBusy("generate"); setError(null)
    try {
      await generateDeck(docId, genPrompt.trim())
      onRefresh?.()
      setGenPrompt("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [docId, genPrompt, onRefresh])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 scrollbar-thin space-y-3">
      <div className="text-[10px] text-muted/80">
        Deck-wide insights and Phase 5 capabilities. Each action is logged and rollback-able.
      </div>

      {error && <div className="text-[10px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1">{error}</div>}

      {/* Generate deck */}
      <div className="bg-base/40 border border-edge/60 rounded p-2">
        <div className="text-[10px] text-accent mb-1 uppercase tracking-wider">Generate Deck</div>
        <textarea value={genPrompt} onChange={(e) => setGenPrompt(e.target.value)}
          placeholder="A 5-slide Q4 board update covering revenue, customers, hiring, risks, outlook"
          rows={2} disabled={busy === "generate"}
          className="w-full text-[11px] bg-base border border-edge rounded px-2 py-1 mb-1 text-slate-200 placeholder:text-muted/50 focus:outline-none focus:border-accent" />
        <button onClick={genDeck} disabled={busy === "generate" || !genPrompt.trim()}
          className="w-full px-2 py-1 rounded text-[10px] bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30 disabled:opacity-40">
          {busy === "generate" ? "Generating…" : "Generate slides from prompt"}
        </button>
      </div>

      {/* Brand check */}
      <div className="bg-base/40 border border-edge/60 rounded p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-accent uppercase tracking-wider">Brand Check</span>
          <button onClick={runBrand} disabled={busy === "brand"}
            className="text-[10px] px-1.5 py-0.5 rounded text-accent hover:bg-accent/10 border border-accent/40 disabled:opacity-40">
            {busy === "brand" ? "Scanning…" : "Run scan"}
          </button>
        </div>
        {brandReport && (
          <div className="text-[10px] space-y-1">
            <div className="text-muted/80">
              Profile: <span className="text-slate-200">{brandReport.profile}</span> · {brandReport.summary.violation_count} violations
            </div>
            {brandReport.summary.violation_count > 0 && (
              <ul className="space-y-0.5 max-h-40 overflow-y-auto scrollbar-thin">
                {brandReport.violations.slice(0, 12).map((v, i) => (
                  <li key={i} className="text-[10px]">
                    <span className={
                      v.severity === "high" ? "text-bad" :
                      v.severity === "medium" ? "text-warn" : "text-muted"
                    }>●</span> slide {v.slide_n}: {v.detail.slice(0, 70)}
                  </li>
                ))}
              </ul>
            )}
            {brandReport.summary.violation_count === 0 && (
              <div className="text-good">✓ All elements on-brand</div>
            )}
          </div>
        )}
      </div>

      {/* Suggestions */}
      <div className="bg-base/40 border border-edge/60 rounded p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-accent uppercase tracking-wider">Suggestions</span>
          <button onClick={loadSuggestions} disabled={busy === "suggestions"}
            className="text-[10px] px-1.5 py-0.5 rounded text-accent hover:bg-accent/10 border border-accent/40 disabled:opacity-40">
            {busy === "suggestions" ? "Loading…" : "Refresh"}
          </button>
        </div>
        {suggestions && suggestions.length === 0 && (
          <div className="text-[10px] text-good">✓ No outstanding suggestions</div>
        )}
        {suggestions && suggestions.length > 0 && (
          <ul className="space-y-0.5 max-h-40 overflow-y-auto scrollbar-thin">
            {suggestions.slice(0, 12).map((s, i) => (
              <li key={i} className="text-[10px]">
                <span className={
                  s.severity === "high" ? "text-bad" :
                  s.severity === "medium" ? "text-warn" : "text-muted"
                }>●</span> {s.slide_n != null ? `slide ${s.slide_n}: ` : ""}{s.title}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Refresh */}
      <div className="bg-base/40 border border-edge/60 rounded p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-accent uppercase tracking-wider">Refresh All Scripts</span>
          <button onClick={refresh} disabled={busy === "refresh"}
            className="text-[10px] px-1.5 py-0.5 rounded text-accent hover:bg-accent/10 border border-accent/40 disabled:opacity-40">
            {busy === "refresh" ? "Running…" : "Run now"}
          </button>
        </div>
        {refreshReport && (
          <div className="text-[10px] space-y-1">
            <div className="text-muted/80">
              {refreshReport.n_scripts} scripts · {refreshReport.n_ok} ok · {refreshReport.n_failed} failed · {refreshReport.n_applied} applied · {refreshReport.total_elapsed_s.toFixed(1)}s
            </div>
            <div className="text-slate-300">{refreshReport.diff_summary}</div>
          </div>
        )}
      </div>
    </div>
  )
}


// ── Activity view (real audit log + rollback) ───────────────────────────────

function ActivityView({
  docId, onRefresh, refreshTick, totalActions,
}: {
  docId: string
  onRefresh?: () => void
  refreshTick?: number
  totalActions: number
}) {
  const [actions, setActions] = useState<AgentAction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rollingBack, setRollingBack] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    listActions(docId, 30)
      .then((r) => { if (!cancelled) setActions(r.actions) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [docId, tick, refreshTick, totalActions])

  const onRollback = useCallback(async (a: AgentAction) => {
    if (!confirm(`Roll back this action?\n\n"${a.prompt.slice(0, 80)}…"`)) return
    setRollingBack(a.id); setError(null)
    try {
      await rollbackAction(a.id)
      onRefresh?.()
      setTick((t) => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRollingBack(null)
    }
  }, [onRefresh])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 scrollbar-thin">
      <div className="text-[10px] text-muted/80 mb-2">
        Every agent action is logged with a snapshot for one-click rollback.
      </div>
      {error && <div className="text-[10px] text-bad bg-bad/10 border border-bad/30 rounded px-2 py-1 mb-2">{error}</div>}
      {!actions ? (
        <div className="text-[11px] text-muted/60 italic">Loading…</div>
      ) : actions.length === 0 ? (
        <div className="text-[11px] text-muted/70 italic">No actions yet.</div>
      ) : (
        <ol className="space-y-2">
          {actions.map((a) => {
            const status = a.status
            const dot =
              status === "executed"  ? "bg-good"     :
              status === "cancelled" ? "bg-muted/60" :
              status === "failed"    ? "bg-bad"      :
                                       "bg-amber-400"
            return (
              <li key={a.id} className="bg-base/40 border border-edge/60 rounded px-2 py-1.5">
                <div className="flex items-center justify-between text-[10px] mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                    <span className="text-muted/70">{new Date(a.created_at * 1000).toLocaleTimeString()}</span>
                    <span className="text-[9px] text-muted/50 font-mono">{a.mode?.replace("_plan", "") || a.kind}</span>
                  </div>
                  <span className="text-[9px] text-muted/60">
                    {a.affected_count} action{a.affected_count === 1 ? "" : "s"}
                    {a.elapsed_ms ? ` · ${a.elapsed_ms}ms` : ""}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 line-clamp-2">{a.prompt}</div>
                {a.error && <div className="text-[10px] text-bad/80 mt-0.5 line-clamp-2">{a.error}</div>}
                <div className="flex justify-end gap-1 mt-1">
                  {a.snapshot_index != null && status !== "cancelled" && (
                    <button onClick={() => onRollback(a)} disabled={rollingBack === a.id}
                      className="text-[9px] px-1.5 py-0.5 rounded text-amber-400 hover:bg-amber-400/10 border border-amber-400/30 disabled:opacity-40">
                      {rollingBack === a.id ? "Rolling back…" : "↶ Rollback"}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
