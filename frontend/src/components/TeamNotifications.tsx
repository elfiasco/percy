import { type Org } from "../lib/authApi"

/**
 * TeamNotifications — thin horizontal strip below the topbar.
 *
 * Only renders for team/org accounts. Shows recent workspace activity
 * (binds, refreshes, approvals, uploads) as scrollable pills.
 *
 * For now this is shape-only — the audit/activity endpoint is not yet
 * exposed at the org level, so we render an empty state. When the
 * endpoint lands, swap the `items` empty-array for a real fetch.
 */

interface NotifItem {
  kind:    "bind" | "refresh" | "approve" | "upload" | "flag"
  initials: string
  who:     string
  text:    string
  target:  string
  ago:     string
  warn?:   boolean
}

export default function TeamNotifications({ activeOrg }: { activeOrg: Org }) {
  if (activeOrg.kind !== "team") return null

  // Empty until the org activity endpoint lands.
  const items: NotifItem[] = []

  return (
    <div className="border-b border-edge bg-surface px-5 py-2 flex items-center gap-2 overflow-x-auto whitespace-nowrap scrollbar-thin">
      <span className="text-[10px] font-semibold uppercase tracking-[0.10em] text-muted pr-2 shrink-0">
        Team · {activeOrg.name}
      </span>

      {items.length === 0 ? (
        <span className="text-[11px] text-muted/70 italic">
          No team activity yet — binds, refreshes, and approvals will appear here.
        </span>
      ) : (
        items.map((it, i) => (
          <NotifPill key={i} item={it} />
        ))
      )}
    </div>
  )
}

function NotifPill({ item }: { item: NotifItem }) {
  const warn = item.warn
  return (
    <div
      className={`inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border text-[12px] shrink-0 cursor-pointer transition-colors
        ${warn
          ? "border-bad/40 bg-bad/8 hover:border-bad/70"
          : "border-edge bg-ink hover:border-champagne"}`}
    >
      <span
        className={`w-[22px] h-[22px] rounded-full text-white text-[10px] font-semibold grid place-items-center shrink-0
          ${warn ? "bg-bad" : "bg-champagne"}`}
      >
        {item.initials}
      </span>
      <span className="text-paper">
        <strong className="font-semibold">{item.who}</strong> {item.text}{" "}
        <strong className="font-semibold">{item.target}</strong>
      </span>
      <span className="text-muted text-[11px] ml-1">{item.ago}</span>
    </div>
  )
}
