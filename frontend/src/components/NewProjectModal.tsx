import { useEffect, useRef, useState } from "react"
import { createProject, uploadProjectFile, type Project } from "../lib/authApi"

/**
 * NewProjectModal — three-mode project creation.
 *
 *   Scratch         : create an empty project. (Eventually a team-template
 *                     picker shows here so it's not "blank" blank.)
 *   From document   : create + upload a .pptx/.pdf right away.
 *   From prompt     : create + stash a generation prompt the Studio picks up
 *                     on first open.
 *
 * Generates an outcome — a full Project — and hands it back to the caller.
 */

type Mode = "scratch" | "document" | "prompt" | null

interface Props {
  orgId: string
  folderId?: string | null
  onClose: () => void
  onCreated: (p: Project, mode: Exclude<Mode, null>) => void
}

const PENDING_PROMPT_KEY = (projectId: string) => `percy_pending_prompt_${projectId}`

export function setPendingPrompt(projectId: string, prompt: string) {
  try { localStorage.setItem(PENDING_PROMPT_KEY(projectId), prompt) } catch {}
}
export function consumePendingPrompt(projectId: string): string | null {
  try {
    const v = localStorage.getItem(PENDING_PROMPT_KEY(projectId))
    if (v) localStorage.removeItem(PENDING_PROMPT_KEY(projectId))
    return v
  } catch { return null }
}

export default function NewProjectModal({ orgId, folderId, onClose, onCreated }: Props) {
  const [mode, setMode]         = useState<Mode>(null)
  const [name, setName]         = useState("")
  const [promptText, setPrompt] = useState("")
  const [file, setFile]         = useState<File | null>(null)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const fileInputRef            = useRef<HTMLInputElement>(null)
  const nameRef                 = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode) setTimeout(() => nameRef.current?.focus(), 50)
  }, [mode])

  // Auto-suggest a project name when uploading a file
  useEffect(() => {
    if (file && !name.trim()) {
      const stem = file.name.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").trim()
      if (stem) setName(stem)
    }
  }, [file, name])

  const canCreate =
    mode === "scratch"  ? name.trim().length > 0
  : mode === "document" ? name.trim().length > 0 && !!file
  : mode === "prompt"   ? name.trim().length > 0 && promptText.trim().length >= 10
  :                       false

  const create = async () => {
    if (!mode || !canCreate) return
    setBusy(true); setError(null)
    try {
      const p = await createProject(orgId, name.trim(), folderId ?? null)
      if (mode === "document" && file) {
        try { await uploadProjectFile(p.id, file) }
        catch (e) {
          // Project exists but upload failed — still surface to caller
          setError(`Project created but upload failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      if (mode === "prompt") {
        setPendingPrompt(p.id, promptText.trim())
      }
      onCreated(p, mode)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
         onClick={busy ? undefined : onClose}>
      <div
        className="w-full max-w-2xl bg-surface border border-edge text-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── header ──────────────────────────────────────────────── */}
        <div className="px-6 pt-6 pb-4 border-b border-edge">
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1.5">— New project —</div>
          <h2 className="text-[20px] font-semibold tracking-[-0.01em]">
            {mode === null
              ? "How do you want to start?"
              : mode === "scratch"  ? "Start from scratch"
              : mode === "document" ? "Start from a document"
              :                       "Start from a prompt"}
          </h2>
        </div>

        {/* ── body ────────────────────────────────────────────────── */}
        <div className="px-6 py-5">
          {mode === null && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ModeCard
                label="Scratch"
                title="Empty deck"
                body="A blank project. Once your team has templates, you'll be able to start from one of those instead."
                onPick={() => setMode("scratch")}
              />
              <ModeCard
                label="Document"
                title="From an existing deck"
                body="Bring a PowerPoint or PDF you already use. Percy will read it, render it, and let you edit every element."
                onPick={() => setMode("document")}
              />
              <ModeCard
                label="Prompt"
                title="From a prompt"
                body="Tell Percy what you want to say. We'll draft a deck you can refine — no blank-page paralysis."
                onPick={() => setMode("prompt")}
              />
            </div>
          )}

          {mode !== null && (
            <div className="space-y-4">
              {/* Name field, common to all modes */}
              <Field label="Project name">
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canCreate && !busy) create() }}
                  placeholder="Q3 Board Update"
                  className="w-full text-[14px] bg-ink border border-edge px-3 py-2 text-paper focus:outline-none focus:border-paper/40"
                />
              </Field>

              {mode === "document" && (
                <Field label="Source file">
                  <div className="space-y-2">
                    <div
                      className="border border-dashed border-edge px-4 py-6 text-center cursor-pointer hover:border-paper/30 hover:bg-paper/5 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault() }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const f = e.dataTransfer.files?.[0]
                        if (f) setFile(f)
                      }}
                    >
                      {file ? (
                        <div>
                          <div className="text-[13px] text-paper">{file.name}</div>
                          <div className="text-[10px] text-muted mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB · click to change</div>
                        </div>
                      ) : (
                        <div>
                          <div className="text-[13px] text-paper">Drop a file here</div>
                          <div className="text-[10px] tracking-[0.14em] uppercase text-muted mt-2">or click to browse</div>
                          <div className="text-[10px] text-muted/70 mt-1">.pptx · .pdf</div>
                        </div>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pptx,.pdf,.ppt"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                  </div>
                </Field>
              )}

              {mode === "prompt" && (
                <Field label="What should the deck cover?">
                  <textarea
                    value={promptText}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="A 10-slide Q3 board update for an early-stage SaaS company. Cover ARR growth, pipeline coverage, hiring plan, and product milestones. Tone: confident, numbers-first."
                    rows={6}
                    className="w-full text-[13px] leading-relaxed bg-ink border border-edge px-3 py-2 text-paper focus:outline-none focus:border-paper/40 resize-y"
                  />
                  <div className="text-[10px] text-muted mt-1.5 leading-relaxed">
                    The more specific you are — audience, tone, key numbers, the structure you want — the closer the first draft lands. You can refine in Studio after.
                  </div>
                </Field>
              )}

              {mode === "scratch" && (
                <div className="text-[11px] text-muted leading-[1.7] border border-edge px-3 py-2.5 bg-ink/40">
                  This project will start as a blank deck. Once your team has brand templates set up, the new-from-scratch flow will let you pick one — for now, scratch means scratch.
                </div>
              )}

              {error && (
                <div className="text-[11px] text-bad bg-bad/10 border border-bad/30 px-3 py-2">{error}</div>
              )}
            </div>
          )}
        </div>

        {/* ── footer ──────────────────────────────────────────────── */}
        <div className="px-6 py-3 border-t border-edge flex items-center justify-between">
          {mode === null ? (
            <>
              <span className="text-[10px] text-muted">Choose a starting point.</span>
              <button onClick={onClose}
                className="text-[10px] tracking-[0.16em] uppercase text-muted hover:text-paper px-3 py-1.5">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setMode(null)} disabled={busy}
                className="text-[10px] tracking-[0.16em] uppercase text-muted hover:text-paper px-3 py-1.5 disabled:opacity-40">
                ← Back
              </button>
              <div className="flex items-center gap-2">
                <button onClick={onClose} disabled={busy}
                  className="text-[10px] tracking-[0.16em] uppercase text-muted hover:text-paper px-3 py-1.5 disabled:opacity-40">
                  Cancel
                </button>
                <button onClick={create} disabled={!canCreate || busy}
                  className="text-[10px] tracking-[0.16em] uppercase bg-paper text-ink hover:bg-paper/90 disabled:opacity-40 px-4 py-1.5 font-medium flex items-center gap-2">
                  {busy && <span className="inline-block w-2 h-2 border border-ink border-t-transparent rounded-full animate-spin" />}
                  {busy ? "Creating…" : "Create project"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── pieces ──────────────────────────────────────────────────────────────────

function ModeCard({ label, title, body, onPick }: {
  label: string; title: string; body: string; onPick: () => void
}) {
  return (
    <button onClick={onPick}
      className="text-left p-4 border border-edge hover:border-paper/40 hover:bg-paper/5 transition-colors min-h-[160px] flex flex-col"
    >
      <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-2">{label}</div>
      <div className="text-[15px] font-semibold tracking-[-0.01em] text-paper mb-2">{title}</div>
      <div className="text-[11px] text-muted leading-[1.6] flex-1">{body}</div>
      <div className="text-[10px] tracking-[0.14em] uppercase text-muted mt-3 group-hover:text-paper">
        Choose →
      </div>
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-1.5">{label}</div>
      {children}
    </div>
  )
}
