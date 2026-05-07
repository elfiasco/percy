import { useState, useEffect } from "react"
import AuditLogPage from "./AuditLogPage"
import BillingPage from "./BillingPage"

interface SSOConfig {
  configured: boolean
  config?: {
    provider: string
    metadata_url: string | null
    sso_url: string | null
    entity_id: string | null
    enabled: number
  }
}

interface Props {
  orgId: string
  orgName: string
  userRole: string
}

export default function OrgSettingsPage({ orgId, orgName, userRole }: Props) {
  const [tab, setTab] = useState<"billing" | "sso" | "audit" | "members">("billing")
  const [sso, setSso] = useState<SSOConfig>({ configured: false })
  const [ssoForm, setSsoForm] = useState({ provider: "saml", metadata_url: "", sso_url: "", entity_id: "", enabled: false })
  const [ssoSaving, setSsoSaving] = useState(false)
  const [toast, setToast] = useState("")

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000) }

  useEffect(() => {
    if (tab === "sso") {
      fetch(`/api/orgs/${orgId}/sso`, { credentials: "include" })
        .then(r => r.json())
        .then(d => {
          setSso(d)
          if (d.config) setSsoForm({ provider: d.config.provider || "saml", metadata_url: d.config.metadata_url || "", sso_url: d.config.sso_url || "", entity_id: d.config.entity_id || "", enabled: Boolean(d.config.enabled) })
        }).catch(() => {})
    }
  }, [tab, orgId])

  const saveSso = async () => {
    setSsoSaving(true)
    try {
      const r = await fetch(`/api/orgs/${orgId}/sso`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ssoForm),
      })
      if (!r.ok) throw new Error("Failed to save")
      const d = await r.json()
      setSso({ configured: true, config: d })
      showToast("SSO configuration saved")
    } catch (e: any) {
      showToast(e.message || "Failed to save SSO config")
    } finally {
      setSsoSaving(false)
    }
  }

  const isAdmin = userRole === "owner" || userRole === "admin"

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{orgName}</h1>
          <p className="text-gray-500 text-sm mt-0.5">Organization settings</p>
        </div>

        <div className="flex gap-1 mb-6 border-b border-gray-200">
          {(["billing", "sso", "audit"] as const).filter(t => t !== "sso" || isAdmin).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${tab === t ? "border-indigo-500 text-indigo-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              {t === "sso" ? "SSO / SAML" : t === "audit" ? "Audit Log" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "billing" && <BillingPage orgId={orgId} />}

        {tab === "audit" && <AuditLogPage orgId={orgId} />}

        {tab === "sso" && isAdmin && (
          <div className="max-w-lg space-y-5">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-4">SAML / SSO Configuration</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                  <select value={ssoForm.provider} onChange={e => setSsoForm(s => ({...s, provider: e.target.value}))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="saml">SAML 2.0</option>
                    <option value="oidc">OpenID Connect</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Metadata URL</label>
                  <input value={ssoForm.metadata_url} onChange={e => setSsoForm(s => ({...s, metadata_url: e.target.value}))}
                    placeholder="https://your-idp.com/metadata"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SSO URL</label>
                  <input value={ssoForm.sso_url} onChange={e => setSsoForm(s => ({...s, sso_url: e.target.value}))}
                    placeholder="https://your-idp.com/sso/saml"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Entity ID / Audience</label>
                  <input value={ssoForm.entity_id} onChange={e => setSsoForm(s => ({...s, entity_id: e.target.value}))}
                    placeholder="https://percy.app/saml/metadata"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="sso-enabled" checked={ssoForm.enabled}
                    onChange={e => setSsoForm(s => ({...s, enabled: e.target.checked}))}
                    className="w-4 h-4 text-indigo-600 rounded" />
                  <label htmlFor="sso-enabled" className="text-sm text-gray-700">Enable SSO for this organization</label>
                </div>
                <button onClick={saveSso} disabled={ssoSaving}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-lg text-sm transition-colors">
                  {ssoSaving ? "Saving…" : "Save SSO configuration"}
                </button>
              </div>
            </div>

            {sso.configured && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                <p className="text-sm font-medium text-green-800">SSO is configured</p>
                <p className="text-xs text-green-700 mt-1">ACS URL: <code className="font-mono">{window.location.origin}/api/auth/saml/callback/{orgId}</code></p>
              </div>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 bg-gray-900 text-white text-sm rounded-xl shadow-lg z-50">{toast}</div>
      )}
    </div>
  )
}
