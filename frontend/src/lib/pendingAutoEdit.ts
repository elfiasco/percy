let _pendingId: string | null = null

export function setPendingAutoEdit(id: string): void { _pendingId = id }
export function consumePendingAutoEdit(id: string): boolean {
  if (_pendingId === id) { _pendingId = null; return true }
  return false
}
