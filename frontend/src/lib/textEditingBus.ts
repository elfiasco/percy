import type { TextFormat, ParagraphFormat } from "./textFormat"

/**
 * Singleton bridge between the ribbon and whichever text element is currently
 * being edited. The active TextRenderer (in edit mode) registers itself; the
 * ribbon checks if an editor is active for a given element id, and if so
 * dispatches the format command to operate on the live DOM selection rather
 * than rewriting every run.
 */

export interface ActiveEditorHandle {
  elementId:        string
  applySelection:   (text: TextFormat, para?: ParagraphFormat) => void
  /** Re-read current selection's format so the ribbon UI reflects it. */
  readSelectionFormat?: () => { text: TextFormat; paragraph: ParagraphFormat } | null
}

let _active: ActiveEditorHandle | null = null
const _listeners: Set<() => void> = new Set()
const _selectionListeners: Set<() => void> = new Set()

export function registerActiveEditor(handle: ActiveEditorHandle): () => void {
  _active = handle
  _listeners.forEach((l) => l())
  return () => {
    if (_active === handle) _active = null
    _listeners.forEach((l) => l())
  }
}

export function getActiveEditor(): ActiveEditorHandle | null {
  return _active
}

/** Subscribe to active-editor changes. Returns an unsubscribe function. */
export function subscribeActiveEditor(cb: () => void): () => void {
  _listeners.add(cb)
  return () => _listeners.delete(cb)
}

/**
 * Subscribe to selection changes within the active editor (cursor moved,
 * range changed, format toggled). The active editor calls notifySelectionChange()
 * after each user action; the ribbon listens so its toggle indicators stay
 * accurate.
 */
export function subscribeSelectionChange(cb: () => void): () => void {
  _selectionListeners.add(cb)
  return () => _selectionListeners.delete(cb)
}

export function notifySelectionChange(): void {
  _selectionListeners.forEach((l) => l())
}

/**
 * Try to apply formatting via the active editor first (if any). Returns true
 * if the active editor handled it. Caller falls back to whole-element apply
 * if false.
 */
export function tryApplyToSelection(
  elementId: string,
  text: TextFormat,
  para?: ParagraphFormat,
): boolean {
  if (_active && _active.elementId === elementId) {
    _active.applySelection(text, para)
    return true
  }
  return false
}
