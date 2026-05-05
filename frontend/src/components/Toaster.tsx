import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react"

/**
 * Toast / dialog / confirm primitives. Use these instead of window.alert(),
 * window.confirm(), or window.prompt() — those are jarring, ugly, and steal
 * focus across the whole browser. The hooks below render in-app overlays
 * styled to match Percy's monochrome palette.
 *
 *   const toast   = useToast()       toast.success("Saved.")
 *                                    toast.error("Couldn't save.")
 *                                    toast.info("Heads up.")
 *
 *   const dialog  = useDialog()      await dialog.confirm({ title, body, danger? })
 *                                    await dialog.prompt({ title, label, placeholder, defaultValue? })
 *
 * The provider sits at the root of the app. Both hooks are imperative —
 * they return promises so callsites read top-to-bottom.
 */

// ── Toast types ──────────────────────────────────────────────────────────────

type ToastVariant = "success" | "error" | "info" | "warn"

interface Toast {
  id: string
  variant: ToastVariant
  title?: string
  body?: string
  duration: number   // ms; 0 = sticky
}

interface ToastApi {
  show:    (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => string
  success: (body: string, title?: string) => string
  error:   (body: string, title?: string) => string
  info:    (body: string, title?: string) => string
  warn:    (body: string, title?: string) => string
  dismiss: (id: string) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) {
    // Falls back to console + alert so callsites don't crash if the provider
    // isn't mounted (e.g., during a render before <ToasterProvider/>).
    return {
      show:    (t) => { console.warn("[toast pre-mount]", t); return "" },
      success: (b) => { console.log(b); return "" },
      error:   (b) => { console.error(b); alert(b); return "" },
      info:    (b) => { console.log(b); return "" },
      warn:    (b) => { console.warn(b); return "" },
      dismiss: () => {},
    }
  }
  return ctx
}

// ── Dialog types ─────────────────────────────────────────────────────────────

interface ConfirmOpts {
  title:        string
  body?:        string
  confirmLabel?: string
  cancelLabel?:  string
  danger?:      boolean        // makes confirm button red, default cancel
}

interface PromptOpts {
  title:        string
  body?:        string
  label?:       string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?:  string
  validate?:    (v: string) => string | null   // return error message or null
}

interface DialogApi {
  confirm: (opts: ConfirmOpts) => Promise<boolean>
  prompt:  (opts: PromptOpts) => Promise<string | null>
}

const DialogCtx = createContext<DialogApi | null>(null)

export function useDialog(): DialogApi {
  const ctx = useContext(DialogCtx)
  if (!ctx) {
    // Pre-mount fallback: native confirm/prompt, so callers never explode.
    return {
      confirm: (o) => Promise.resolve(window.confirm([o.title, o.body].filter(Boolean).join("\n\n"))),
      prompt:  (o) => Promise.resolve(window.prompt([o.title, o.body].filter(Boolean).join("\n\n"), o.defaultValue ?? "")),
    }
  }
  return ctx
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function ToasterProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts]   = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const [promptState,  setPromptState]  = useState<(PromptOpts  & { resolve: (v: string | null) => void }) | null>(null)

  // ── toast actions ───────────────────────────────────────────────────────
  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id))
  }, [])

  const show = useCallback((t: Omit<Toast, "id" | "duration"> & { duration?: number }) => {
    const id = Math.random().toString(36).slice(2, 10)
    const duration = t.duration ?? (t.variant === "error" ? 6000 : 3500)
    setToasts((cur) => [...cur, { ...t, id, duration }])
    if (duration > 0) {
      setTimeout(() => {
        setToasts((cur) => cur.filter((x) => x.id !== id))
      }, duration)
    }
    return id
  }, [])

  const toastApi: ToastApi = {
    show,
    success: (body, title) => show({ variant: "success", body, title }),
    error:   (body, title) => show({ variant: "error",   body, title }),
    info:    (body, title) => show({ variant: "info",    body, title }),
    warn:    (body, title) => show({ variant: "warn",    body, title }),
    dismiss,
  }

  // ── dialog actions ──────────────────────────────────────────────────────
  const dialogApi: DialogApi = {
    confirm: (opts) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })),
    prompt:  (opts) => new Promise<string | null>((resolve) => setPromptState({ ...opts, resolve })),
  }

  return (
    <ToastCtx.Provider value={toastApi}>
      <DialogCtx.Provider value={dialogApi}>
        {children}
        <ToastViewport toasts={toasts} onDismiss={dismiss} />
        {confirmState && (
          <ConfirmDialog
            opts={confirmState}
            onResolve={(v) => { confirmState.resolve(v); setConfirmState(null) }}
          />
        )}
        {promptState && (
          <PromptDialog
            opts={promptState}
            onResolve={(v) => { promptState.resolve(v); setPromptState(null) }}
          />
        )}
      </DialogCtx.Provider>
    </ToastCtx.Provider>
  )
}

// ── viewport ─────────────────────────────────────────────────────────────────

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-5 right-5 z-[2000] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // Variant → color band + icon
  const palette = (() => {
    switch (toast.variant) {
      case "success": return { band: "bg-verdigris", icon: "✓",  iconColor: "text-verdigris" }
      case "error":   return { band: "bg-bad",       icon: "!",  iconColor: "text-bad" }
      case "warn":    return { band: "bg-ochre",     icon: "!",  iconColor: "text-ochre" }
      case "info":
      default:        return { band: "bg-paper/60",  icon: "·",  iconColor: "text-paper" }
    }
  })()
  return (
    <div
      role="status"
      className="pointer-events-auto min-w-[260px] max-w-md bg-surface border border-edge shadow-2xl flex overflow-hidden animate-toast-in"
      onClick={onDismiss}
      style={{ background: "rgb(var(--surface))" }}
    >
      <div className={`w-1 shrink-0 ${palette.band}`} />
      <div className="flex-1 px-3 py-2.5 min-w-0">
        {toast.title && (
          <div className="text-[11px] tracking-[0.14em] uppercase text-paper font-medium mb-0.5">
            <span className={`mr-1.5 ${palette.iconColor}`}>{palette.icon}</span>
            {toast.title}
          </div>
        )}
        {toast.body && (
          <div className={`text-[12px] leading-relaxed ${toast.title ? "text-muted" : "text-paper"}`}>
            {!toast.title && <span className={`mr-1.5 ${palette.iconColor}`}>{palette.icon}</span>}
            {toast.body}
          </div>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss() }}
        className="text-muted hover:text-paper px-2 text-base leading-none self-start pt-2"
        aria-label="Dismiss"
      >×</button>
    </div>
  )
}

// ── confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  opts, onResolve,
}: { opts: ConfirmOpts; onResolve: (v: boolean) => void }) {
  return (
    <DialogShell onCancel={() => onResolve(false)}>
      <div className="px-6 pt-5 pb-4">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-paper mb-2">{opts.title}</h2>
        {opts.body && (
          <p className="text-[12px] text-muted leading-[1.7]">{opts.body}</p>
        )}
      </div>
      <div className="px-6 py-3 border-t border-edge flex items-center justify-end gap-2">
        <button
          onClick={() => onResolve(false)}
          className="text-[10px] tracking-[0.14em] uppercase text-muted hover:text-paper border border-edge px-3 py-1.5 hover:bg-paper/5 transition-colors"
        >
          {opts.cancelLabel ?? "Cancel"}
        </button>
        <button
          autoFocus
          onClick={() => onResolve(true)}
          className={`text-[10px] tracking-[0.14em] uppercase px-4 py-1.5 font-medium transition-colors ${
            opts.danger
              ? "bg-bad text-paper hover:bg-bad/90"
              : "bg-paper text-ink hover:bg-paper/90"
          }`}
        >
          {opts.confirmLabel ?? (opts.danger ? "Delete" : "Confirm")}
        </button>
      </div>
    </DialogShell>
  )
}

// ── prompt dialog ────────────────────────────────────────────────────────────

function PromptDialog({
  opts, onResolve,
}: { opts: PromptOpts; onResolve: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.defaultValue ?? "")
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 30) }, [])

  const submit = () => {
    const trimmed = value.trim()
    if (opts.validate) {
      const e = opts.validate(trimmed)
      if (e) { setError(e); return }
    }
    onResolve(trimmed)
  }

  return (
    <DialogShell onCancel={() => onResolve(null)}>
      <div className="px-6 pt-5 pb-4">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-paper mb-2">{opts.title}</h2>
        {opts.body && <p className="text-[12px] text-muted leading-[1.7] mb-3">{opts.body}</p>}
        {opts.label && <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-1.5">{opts.label}</div>}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null) }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit() }
            if (e.key === "Escape") { e.preventDefault(); onResolve(null) }
          }}
          placeholder={opts.placeholder}
          className="w-full text-[14px] bg-ink border border-edge px-3 py-2 text-paper focus:outline-none focus:border-paper/40"
        />
        {error && <div className="text-[11px] text-bad mt-1.5">{error}</div>}
      </div>
      <div className="px-6 py-3 border-t border-edge flex items-center justify-end gap-2">
        <button
          onClick={() => onResolve(null)}
          className="text-[10px] tracking-[0.14em] uppercase text-muted hover:text-paper border border-edge px-3 py-1.5 hover:bg-paper/5 transition-colors"
        >
          {opts.cancelLabel ?? "Cancel"}
        </button>
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="text-[10px] tracking-[0.14em] uppercase bg-paper text-ink hover:bg-paper/90 disabled:opacity-40 px-4 py-1.5 font-medium"
        >
          {opts.confirmLabel ?? "OK"}
        </button>
      </div>
    </DialogShell>
  )
}

// ── shared shell ─────────────────────────────────────────────────────────────

function DialogShell({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  // Esc to cancel, click backdrop to cancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-surface border border-edge shadow-2xl"
        style={{ background: "rgb(var(--surface))" }}
      >
        {children}
      </div>
    </div>
  )
}

// ── animation styles (one-shot inject) ───────────────────────────────────────

if (typeof document !== "undefined" && !document.getElementById("percy-toast-style")) {
  const style = document.createElement("style")
  style.id = "percy-toast-style"
  style.textContent = `
    @keyframes toast-in {
      0%   { opacity: 0; transform: translateX(20px) translateY(4px); }
      100% { opacity: 1; transform: translateX(0)    translateY(0); }
    }
    .animate-toast-in { animation: toast-in 220ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
  `
  document.head.appendChild(style)
}
