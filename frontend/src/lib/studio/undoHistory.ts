/**
 * Client-side undo/redo history for Studio commands.
 *
 * Each history entry stores a do/undo function pair. Commands push entries
 * before execution; undo/redo replay the inverse/original side effects.
 *
 * The history is capped at MAX_DEPTH to prevent unbounded memory growth.
 * Navigating to a new slide clears the history.
 */

const MAX_DEPTH = 80

export interface HistoryEntry {
  label: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

class UndoHistory {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private listeners = new Set<() => void>()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift()
    this.redoStack = []
    this.notify()
  }

  async undo(): Promise<boolean> {
    const entry = this.undoStack.pop()
    if (!entry) return false
    this.redoStack.push(entry)
    await entry.undo()
    this.notify()
    return true
  }

  async redo(): Promise<boolean> {
    const entry = this.redoStack.pop()
    if (!entry) return false
    this.undoStack.push(entry)
    await entry.redo()
    this.notify()
    return true
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.notify()
  }

  canUndo(): boolean { return this.undoStack.length > 0 }
  canRedo(): boolean { return this.redoStack.length > 0 }
  undoLabel(): string | null { return this.undoStack.at(-1)?.label ?? null }
  redoLabel(): string | null { return this.redoStack.at(-1)?.label ?? null }
}

export const undoHistory = new UndoHistory()

// ── React hook ─────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from "react"

function getUndoSnapshot() {
  return { canUndo: undoHistory.canUndo(), canRedo: undoHistory.canRedo(), undoLabel: undoHistory.undoLabel(), redoLabel: undoHistory.redoLabel() }
}

let _undoSnapshot = getUndoSnapshot()

undoHistory.subscribe(() => { _undoSnapshot = getUndoSnapshot() })

export function useUndoState(): { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null } {
  return useSyncExternalStore(
    (fn) => undoHistory.subscribe(fn),
    () => _undoSnapshot,
    () => _undoSnapshot,
  )
}
