import type { YjsRoom } from "./yjsRoom"
import type { PercyUserPresence } from "./awareness"

/**
 * Studio-level collaboration handle. The Studio shell decides if a slide
 * should be edited in collaborative mode (Yjs room + awareness) or local-only
 * (no sync). Renderers consult this handle to opt into the y-prosemirror
 * binding when present, falling back to plain Tiptap when absent.
 *
 * The handle is set/cleared via setCollabContext when the slide changes.
 */

export interface CollabContext {
  room:      YjsRoom
  user:      PercyUserPresence
  /**
   * True when Yjs is acting as the source of truth for text content. When
   * false (e.g. in plain local-only mode), Tiptap loads from Bridge JSON
   * directly and saves on blur — no shared XmlFragment.
   */
  enabled:   boolean
}

let _ctx: CollabContext | null = null

export function setCollabContext(ctx: CollabContext | null): void {
  _ctx = ctx
}

export function getCollabContext(): CollabContext | null {
  return _ctx
}
