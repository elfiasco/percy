import type { Editor } from "@tiptap/core"

/**
 * Tracks which Tiptap editor (if any) currently has focus, so the ribbon's
 * TextFormatGroup knows where to dispatch commands and which selection to
 * read state from.
 *
 * Exactly one editor is "active" at a time — the most recently mounted /
 * focused one. When an editor unmounts (user finishes editing), it clears
 * itself.
 *
 * The ribbon subscribes to `subscribe()` so its toggle indicators re-render
 * on every selection change without us having to plumb refs through the
 * component tree.
 */

export interface ActiveTiptapEditor {
  elementId: string
  editor:    Editor
}

let _active: ActiveTiptapEditor | null = null
const _listeners = new Set<() => void>()

/** Mount-time call from the renderer. Returns an unsubscribe function. */
export function setActiveTiptapEditor(handle: ActiveTiptapEditor): () => void {
  _active = handle
  notify()

  // Subscribe to every relevant editor event — ribbon needs to update on
  // selection moves, format changes, doc changes.
  const onChange = () => notify()
  handle.editor.on("selectionUpdate", onChange)
  handle.editor.on("transaction",     onChange)
  handle.editor.on("focus",           onChange)
  handle.editor.on("blur",            onChange)

  return () => {
    handle.editor.off("selectionUpdate", onChange)
    handle.editor.off("transaction",     onChange)
    handle.editor.off("focus",           onChange)
    handle.editor.off("blur",            onChange)
    if (_active === handle) {
      _active = null
      notify()
    }
  }
}

export function getActiveTiptapEditor(): ActiveTiptapEditor | null {
  return _active
}

/** Subscribe to active-editor changes (mount/unmount/selection/transactions). */
export function subscribeActiveEditor(cb: () => void): () => void {
  _listeners.add(cb)
  return () => _listeners.delete(cb)
}

function notify(): void {
  _listeners.forEach((l) => l())
}
