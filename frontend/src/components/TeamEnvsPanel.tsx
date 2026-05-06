import { useEffect, useState } from "react"
import {
  listTeamEnvs, createTeamEnv, updateTeamEnv, deleteTeamEnv, buildTeamEnv,
  type TeamEnv,
} from "../lib/authApi"
import { useToast, useDialog } from "./Toaster"

interface Props {
  orgId: string
  isAdmin: boolean
}

export default function TeamEnvsPanel({ orgId, isAdmin }: Props) {
  const [envs, setEnvs] = useState<TeamEnv[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState("")

  const toast = useToast()
  const dialog = useDialog()

  const refresh = async () => {
    try {
      const r = await listTeamEnvs(orgId)
      setEnvs(r.envs)
      if (r.envs.length && !selectedId) setSelectedId(r.envs[0].id)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => { refresh() }, [orgId])

  const onCreate = async () => {
    const n = newName.trim()
    if (!n) return
    setBusy(true)
    try {
      const env = await createTeamEnv(orgId, n)
      setNewName("")
      setSelectedId(env.id)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), "Couldn't create environment")
    } finally { setBusy(false) }
  }

  const selected = envs.find((e) => e.id === selectedId) || null

  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 h-full">
      {/* Sidebar list */}
      <div className="border border-edge rounded p-2 flex flex-col gap-1.5 min-h-0">
        <div className="text-[10px] uppercase tracking-widest text-muted px-1 mb-1">Environments</div>
        {envs.map((e) => (
          <button key={e.id} onClick={() => setSelectedId(e.id)}
            className={`text-left px-2 py-1.5 rounded text-xs ${selectedId === e.id ? "bg-accent/15 text-slate-200" : "text-muted hover:text-slate-300 hover:bg-white/5"}`}
          >
            <div className="truncate">{e.name}</div>
            <div className={`text-[9px] uppercase tracking-wider mt-0.5 ${
              e.status === "ready" ? "text-good" :
              e.status === "building" ? "text-accent" :
              e.status === "failed" ? "text-bad" : "text-muted/70"}`}>{e.status}</div>
          </button>
        ))}
        {envs.length === 0 && <div className="text-[11px] text-muted/70 italic px-1 py-2">None yet.</div>}
        {isAdmin && (
          <div className="mt-2 pt-2 border-t border-edge flex gap-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New env name"
              className="flex-1 text-xs bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent min-w-0"
            />
            <button onClick={onCreate} disabled={busy || !newName.trim()}
              className="text-xs px-2 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-40">+</button>
          </div>
        )}
      </div>

      {/* Detail editor */}
      <div className="min-h-0 overflow-y-auto pr-1 scrollbar-thin">
        {error && <div className="text-xs text-bad bg-bad/10 border border-bad/30 rounded px-3 py-2 mb-3">{error}</div>}
        {!selected ? (
          <div className="text-xs text-muted italic px-1 py-3">
            Pick an environment, or create one. Each environment is a Python venv
            with its own packages, env vars, and (optionally) credentials for a
            private package index like Artifactory.
          </div>
        ) : (
          <EnvEditor key={selected.id} env={selected} isAdmin={isAdmin} onChanged={refresh}
            onDelete={async () => {
              const ok = await dialog.confirm({ title: `Delete ${selected.name}?`, body: "The on-disk venv will be removed.", confirmLabel: "Delete", danger: true })
              if (!ok) return
              try { await deleteTeamEnv(selected.id); setSelectedId(null); await refresh() }
              catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
            }}
          />
        )}
      </div>
    </div>
  )
}


function EnvEditor({ env, isAdmin, onChanged, onDelete }: {
  env: TeamEnv; isAdmin: boolean; onChanged: () => void; onDelete: () => void
}) {
  const [requirements, setRequirements] = useState(env.requirements || "")
  const [envVarsText, setEnvVarsText] = useState(
    Object.entries(env.env_vars || {}).map(([k, v]) => `${k}=${v}`).join("\n")
  )
  const [indexUrl, setIndexUrl] = useState(env.package_index_url || "")
  const [indexUser, setIndexUser] = useState(env.package_index_user || "")
  const [indexToken, setIndexToken] = useState("")
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    setRequirements(env.requirements || "")
    setEnvVarsText(Object.entries(env.env_vars || {}).map(([k, v]) => `${k}=${v}`).join("\n"))
    setIndexUrl(env.package_index_url || "")
    setIndexUser(env.package_index_user || "")
    setIndexToken("")
  }, [env.id])

  const parseEnvVars = (txt: string): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const line of txt.split("\n")) {
      const t = line.trim()
      if (!t || t.startsWith("#")) continue
      const i = t.indexOf("=")
      if (i <= 0) continue
      out[t.slice(0, i).trim()] = t.slice(i + 1)
    }
    return out
  }

  const onSave = async () => {
    setBusy(true)
    try {
      const fields: Record<string, unknown> = {
        requirements,
        env_vars: parseEnvVars(envVarsText),
        package_index_url: indexUrl || null,
        package_index_user: indexUser || null,
      }
      if (indexToken) fields.package_index_token = indexToken
      await updateTeamEnv(env.id, fields)
      toast.success("Saved.")
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), "Save failed")
    } finally { setBusy(false) }
  }

  const onBuild = async () => {
    setBusy(true)
    try {
      const r = await buildTeamEnv(env.id)
      if (r.status === "ready") toast.success("Build succeeded.")
      else if (r.status === "failed") toast.error("Build failed — check the install log.", "Build failed")
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), "Build failed")
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted">Environment</div>
          <h3 className="text-sm font-semibold text-slate-200 tracking-tight">{env.name}</h3>
        </div>
        {isAdmin && (
          <button onClick={onDelete} className="text-[10px] uppercase tracking-wider text-muted hover:text-bad">Delete</button>
        )}
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">requirements.txt</label>
        <textarea
          rows={6} value={requirements} onChange={(e) => setRequirements(e.target.value)}
          disabled={!isAdmin}
          placeholder={`pandas==2.1.0\nrequests\n# pin private internal pkg:\n# my-internal-lib==4.2`}
          className="w-full text-xs font-mono bg-base border border-edge rounded px-2 py-2 text-slate-200 focus:outline-none focus:border-accent disabled:opacity-60"
        />
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-widest text-muted mb-1">Environment variables</label>
        <textarea
          rows={4} value={envVarsText} onChange={(e) => setEnvVarsText(e.target.value)}
          disabled={!isAdmin}
          placeholder={`KEY=value\nDB_URL=postgres://...`}
          className="w-full text-xs font-mono bg-base border border-edge rounded px-2 py-2 text-slate-200 focus:outline-none focus:border-accent disabled:opacity-60"
        />
        <div className="text-[10px] text-muted mt-1 italic">One per line. Plaintext for v1; production stores in Secrets Manager.</div>
      </div>

      <details className="border border-edge rounded p-3" open={!!env.package_index_url}>
        <summary className="text-[11px] uppercase tracking-wider text-muted cursor-pointer select-none">Private package index (Artifactory / Nexus / CodeArtifact)</summary>
        <div className="mt-3 space-y-2">
          <input
            value={indexUrl} onChange={(e) => setIndexUrl(e.target.value)} disabled={!isAdmin}
            placeholder="https://artifactory.example.com/api/pypi/pypi-internal/simple"
            className="w-full text-xs bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent disabled:opacity-60"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={indexUser} onChange={(e) => setIndexUser(e.target.value)} disabled={!isAdmin}
              placeholder="Username (optional)"
              className="text-xs bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent disabled:opacity-60"
            />
            <input
              type="password"
              value={indexToken} onChange={(e) => setIndexToken(e.target.value)} disabled={!isAdmin}
              placeholder={env.package_index_token_set ? "(token saved — type to replace)" : "Token / API key"}
              className="text-xs bg-base border border-edge rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-accent disabled:opacity-60"
            />
          </div>
        </div>
      </details>

      <div className="flex items-center gap-2">
        {isAdmin && (
          <>
            <button onClick={onSave} disabled={busy}
              className="text-xs px-3 py-1.5 rounded bg-accent/30 text-accent border border-accent/40 hover:bg-accent/40 disabled:opacity-40">Save</button>
            <button onClick={onBuild} disabled={busy}
              className="text-xs px-3 py-1.5 rounded bg-good/20 text-good border border-good/40 hover:bg-good/30 disabled:opacity-40">
              {env.status === "ready" ? "Rebuild" : "Build venv"}
            </button>
          </>
        )}
        <span className="text-[10px] text-muted ml-2">
          status: <span className={
            env.status === "ready" ? "text-good" :
            env.status === "building" ? "text-accent" :
            env.status === "failed" ? "text-bad" : "text-muted"
          }>{env.status}</span>
          {env.last_built_at ? <> · last built {new Date(env.last_built_at * 1000).toLocaleString()}</> : null}
        </span>
      </div>

      {env.last_build_log && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted mb-1">Install log</div>
          <pre className="text-[10px] font-mono bg-base border border-edge rounded p-2 max-h-60 overflow-auto whitespace-pre-wrap break-all">{env.last_build_log}</pre>
        </div>
      )}
    </div>
  )
}
