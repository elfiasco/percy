/**
 * Studio modal registry — replaces hundreds of individual `useState(false)` booleans.
 *
 * Modals are registered with an ID (string) and opened/closed through a shared
 * store. This allows:
 *   - Command palette entries to open modals by ID
 *   - Keyboard shortcuts to open modals by ID
 *   - At-most-one exclusive modal (like a dialog stack)
 *   - Easy enumeration for the command palette
 *
 * Usage:
 *   // Opening:
 *   openModal("grammar-check")
 *
 *   // Checking:
 *   const isOpen = useModalOpen("grammar-check")
 *
 *   // Closing (from inside the modal):
 *   closeModal("grammar-check")
 */

import { useSyncExternalStore } from "react"

type ModalId = string

// The registry stores the set of currently open modal IDs.
// Multiple modals can be open simultaneously (e.g. agent panel + a tool modal).
let _openModals: Set<ModalId> = new Set()
const _listeners = new Set<() => void>()

function notify(): void {
  for (const fn of _listeners) fn()
}

function getSnapshot(): Set<ModalId> {
  return _openModals
}

// We snapshot the SET reference on each open/close so useSyncExternalStore
// detects the change.
export function openModal(id: ModalId): void {
  if (_openModals.has(id)) return
  _openModals = new Set(_openModals)
  _openModals.add(id)
  notify()
}

export function closeModal(id: ModalId): void {
  if (!_openModals.has(id)) return
  _openModals = new Set(_openModals)
  _openModals.delete(id)
  notify()
}

export function toggleModal(id: ModalId): void {
  if (_openModals.has(id)) closeModal(id)
  else openModal(id)
}

export function isModalOpen(id: ModalId): boolean {
  return _openModals.has(id)
}

export function closeAllModals(): void {
  if (_openModals.size === 0) return
  _openModals = new Set()
  notify()
}

// ── React hooks ────────────────────────────────────────────────────────────────

function subscribeModals(fn: () => void): () => void {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

/** Returns true if the given modal is currently open. */
export function useModalOpen(id: ModalId): boolean {
  const set = useSyncExternalStore(subscribeModals, getSnapshot, getSnapshot)
  return set.has(id)
}

/** Returns the full set of open modal IDs (for the modal host to render them). */
export function useOpenModals(): Set<ModalId> {
  return useSyncExternalStore(subscribeModals, getSnapshot, getSnapshot)
}
