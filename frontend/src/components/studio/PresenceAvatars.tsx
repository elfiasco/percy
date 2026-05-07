import type { PercyUserPresence } from "../../lib/collab/awareness"

/**
 * Avatar stack rendered in the studio top bar — shows the local user
 * plus everyone else currently connected to the same slide. Pure visual;
 * the data comes from useStudioCollab's awareness updates.
 */
function initials(name: string): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function Bubble({ user, isSelf }: { user: PercyUserPresence; isSelf?: boolean }) {
  return (
    <div
      title={isSelf ? `${user.name} (you)` : user.name}
      className="w-7 h-7 -ml-1.5 first:ml-0 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold text-paper select-none shadow-sm"
      style={{
        backgroundColor: user.color,
        borderColor: "rgb(var(--surface) / 1)",
        boxShadow: isSelf ? `0 0 0 1px ${user.color}` : undefined,
        zIndex: isSelf ? 10 : undefined,
      }}
    >
      {initials(user.name)}
    </div>
  )
}

export default function PresenceAvatars({
  localUser, remoteUsers, max = 5,
}: {
  localUser: PercyUserPresence | null
  remoteUsers: PercyUserPresence[]
  max?: number
}) {
  const visible = remoteUsers.slice(0, max)
  const overflow = Math.max(0, remoteUsers.length - max)
  if (!localUser && remoteUsers.length === 0) return null
  return (
    <div className="flex items-center gap-1.5">
      {remoteUsers.length > 0 && (
        <div className="text-[9px] uppercase tracking-[0.16em] text-muted mr-1">
          {remoteUsers.length === 0 ? "" :
            remoteUsers.length === 1 ? "1 collaborator" : `${remoteUsers.length} collaborators`}
        </div>
      )}
      <div className="flex">
        {localUser && <Bubble user={localUser} isSelf />}
        {visible.map((u) => <Bubble key={u.userId} user={u} />)}
        {overflow > 0 && (
          <div className="w-7 h-7 -ml-1.5 rounded-full border-2 border-surface bg-base text-[10px] font-semibold text-muted flex items-center justify-center">
            +{overflow}
          </div>
        )}
      </div>
    </div>
  )
}
