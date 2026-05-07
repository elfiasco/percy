import { useState, useEffect } from "react"

interface Plan {
  id: string
  name: string
  max_seats: number
  max_projects: number
  features: string[]
  price_monthly: number
  price_annual: number
  is_default: number
}

interface Subscription {
  plan_id: string
  seats_purchased: number
  status: string
  current_period_end: number | null
}

interface Props {
  orgId: string
}

export default function BillingPage({ orgId }: Props) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [sub, setSub] = useState<Subscription | null>(null)
  const [seatsUsed, setSeatsUsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState("")

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(""), 3000)
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/plans", { credentials: "include" }).then(r => r.json()),
      fetch(`/api/orgs/${orgId}/subscription`, { credentials: "include" }).then(r => r.json()),
    ]).then(([p, s]) => {
      setPlans(p.plans || [])
      setSub(s.subscription)
      setSeatsUsed(s.seats_used || 0)
    }).finally(() => setLoading(false))
  }, [orgId])

  const upgradePlan = async (planId: string) => {
    try {
      const r = await fetch(`/api/orgs/${orgId}/subscription`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      })
      if (!r.ok) throw new Error("Failed to update plan")
      const d = await r.json()
      setSub(d)
      showToast("Plan updated!")
    } catch (e: any) {
      showToast(e.message || "Failed to update plan")
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading billing…</div>

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing & Plans</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your subscription and seats</p>
      </div>

      {/* Current usage */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Current usage</h2>
        <div className="flex gap-8">
          <div>
            <p className="text-3xl font-bold text-gray-900">{seatsUsed}</p>
            <p className="text-sm text-gray-500">Seats used of {sub?.seats_purchased || 5}</p>
            <div className="mt-2 h-2 bg-gray-100 rounded-full w-40">
              <div className="h-2 bg-indigo-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (seatsUsed / (sub?.seats_purchased || 5)) * 100)}%` }} />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">Current plan</p>
            <p className="text-lg font-bold text-indigo-600 capitalize">
              {plans.find(p => p.id === sub?.plan_id)?.name || "Free"}
            </p>
            <p className={`text-xs mt-1 font-medium ${sub?.status === "active" ? "text-green-600" : "text-red-600"}`}>
              {sub?.status || "active"}
            </p>
          </div>
        </div>
      </div>

      {/* Plans */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Available plans</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {plans.map(plan => {
            const isCurrent = plan.id === sub?.plan_id
            return (
              <div key={plan.id} className={`rounded-xl border p-5 flex flex-col ${isCurrent ? "border-indigo-500 bg-indigo-50/50" : "border-gray-200 bg-white"}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">{plan.name}</h3>
                    <p className="text-sm text-gray-500">Up to {plan.max_seats} seats</p>
                  </div>
                  {isCurrent && <span className="text-xs font-medium text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">Current</span>}
                </div>
                <div className="mb-4">
                  {plan.price_monthly > 0
                    ? <p className="text-2xl font-bold text-gray-900">${(plan.price_monthly / 100).toFixed(0)}<span className="text-sm font-normal text-gray-500">/mo</span></p>
                    : <p className="text-2xl font-bold text-gray-900">Free</p>
                  }
                </div>
                <ul className="space-y-1.5 mb-5 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-1.5 text-sm text-gray-600">
                      <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => !isCurrent && upgradePlan(plan.id)}
                  disabled={isCurrent}
                  className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${
                    isCurrent ? "bg-gray-100 text-gray-400 cursor-default" : "bg-indigo-600 hover:bg-indigo-700 text-white"
                  }`}>
                  {isCurrent ? "Current plan" : plan.price_monthly > 0 ? "Upgrade" : "Downgrade"}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 bg-gray-900 text-white text-sm rounded-xl shadow-lg z-50">{toast}</div>
      )}
    </div>
  )
}
