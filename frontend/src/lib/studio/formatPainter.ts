// ── Format Painter (Ctrl+Alt+C / Ctrl+Alt+V) ──────────────────────────────────
// Holds a snapshot of source-element style fields and replays them onto target
// elements. Mirrors Google Slides' Paint Format tool:
//   - Single-click paintbrush  → apply once, then deactivate
//   - Double-click paintbrush  → "sticky mode", apply repeatedly until Esc
//
// What's copied (shape/text):
//   fill_color, line_color, line_width, line_dash, opacity,
//   shadow_on/color/blur/offset_x/offset_y
//
// Text-run style (font family/size/color/bold/italic/etc.) is stored
// separately because it lives inside the Bridge text content, not in
// ElementStyleData. We capture and replay it via the text style endpoint.

import type { ElementStyleData, ElementStyleUpdate } from "../studioTypes"
import { commitElementStyle } from "./commands"
import { studioStore } from "./store"

export interface FormatClipboard {
  sourceId: string
  style: ElementStyleUpdate
  capturedAt: number
}

type Listener = () => void

class FormatPainter {
  private clipboard: FormatClipboard | null = null
  private active: boolean = false      // single-shot: turns off after one paste
  private sticky: boolean = false      // double-click: stays on until Esc
  private listeners = new Set<Listener>()

  // ── subscription ──────────────────────────────────────────────────────────
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  // ── public API ────────────────────────────────────────────────────────────

  /** Capture the currently selected element's style, arm the painter. */
  capture(sourceId: string, sticky = false): boolean {
    const payload = studioStore.getSnapshot().payloads[sourceId]
    const style = payload?.style
    if (!style) return false

    this.clipboard = {
      sourceId,
      style: pickPaintableFields(style),
      capturedAt: Date.now(),
    }
    this.active = true
    this.sticky = sticky
    this.emit()
    return true
  }

  /** Toggle: if armed, disarm; if not armed but selection exists, capture. */
  toggle(selectedId: string | null, sticky = false): void {
    if (this.active) { this.deactivate(); return }
    if (selectedId) this.capture(selectedId, sticky)
  }

  /** Apply the stored format to a target element. Returns true if applied. */
  async paste(targetId: string): Promise<boolean> {
    const clip = this.clipboard
    if (!clip || !this.active) return false
    if (clip.sourceId === targetId) return false   // skip self-paste

    try {
      await commitElementStyle(targetId, clip.style)
    } catch (e) {
      console.error("[Percy] format painter paste failed:", e)
      return false
    }
    if (!this.sticky) this.deactivate()
    return true
  }

  /** Disarm. */
  deactivate(): void {
    if (!this.active) return
    this.active = false
    this.sticky = false
    this.emit()
  }

  /** Clear stored clipboard entirely. */
  clear(): void {
    this.clipboard = null
    this.active    = false
    this.sticky    = false
    this.emit()
  }

  // ── getters ──────────────────────────────────────────────────────────────
  isActive(): boolean { return this.active }
  isSticky(): boolean { return this.sticky }
  getClipboard(): FormatClipboard | null { return this.clipboard }
}

export const formatPainter = new FormatPainter()

// ── Selectors / hooks ────────────────────────────────────────────────────────

import { useSyncExternalStore } from "react"

export function useFormatPainter(): { active: boolean; sticky: boolean; hasClipboard: boolean } {
  return useSyncExternalStore(
    formatPainter.subscribe.bind(formatPainter),
    () => ({
      active: formatPainter.isActive(),
      sticky: formatPainter.isSticky(),
      hasClipboard: formatPainter.getClipboard() !== null,
    }),
    () => ({ active: false, sticky: false, hasClipboard: false }),
  )
}

// ── Field selection ─────────────────────────────────────────────────────────

/** Pick only the style fields that Format Painter copies (Google Slides parity). */
function pickPaintableFields(style: ElementStyleData): ElementStyleUpdate {
  const out: ElementStyleUpdate = {}
  // Fill
  if (style.fill_color !== null) out.fill_color = style.fill_color
  if (style.fill_type  !== null) out.fill_type  = style.fill_type
  if (style.gradient_stops)      out.gradient_stops = style.gradient_stops.map((s) => ({ position: s.position, color: s.color ?? "#000000" }))
  if (style.gradient_angle !== null) out.gradient_angle = style.gradient_angle
  // Line
  if (style.line_color !== null) out.line_color = style.line_color
  if (style.line_width !== null) out.line_width = style.line_width
  if (style.line_dash  !== null) out.line_dash  = style.line_dash
  // Opacity
  if (style.opacity !== null) out.opacity = style.opacity
  // Shadow
  if (style.shadow_on !== null) {
    out.shadow_on       = style.shadow_on
    out.shadow_color    = style.shadow_color
    out.shadow_blur     = style.shadow_blur
    out.shadow_offset_x = style.shadow_offset_x
    out.shadow_offset_y = style.shadow_offset_y
  }
  return out
}
