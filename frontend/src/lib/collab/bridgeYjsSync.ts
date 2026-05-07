import * as Y from "yjs"
import type { StudioElement, ParagraphsTextContent } from "../studioTypes"
import { paragraphsToTiptap } from "../bridge/tiptapAdapter"
import { bridgeExtensions } from "../bridge/extensions"
import { prosemirrorJSONToYXmlFragment } from "y-prosemirror"
import { getSchema } from "@tiptap/core"
import type { YjsRoom } from "./yjsRoom"

/**
 * Hydration adapter — copies Bridge data INTO a Y.Doc on first connect.
 *
 * Bridge stays canonical: the disk format never changes. This module owns
 * the "lift Bridge JSON into shared Yjs types so collaborators can edit
 * concurrently" step.
 *
 * Two flavors:
 *
 *   - hydrateElement       : copy one StudioElement's fields (position,
 *                            type, etc.) into its Y.Map. Idempotent — safe
 *                            to re-call.
 *   - hydrateElementText   : copy a ParagraphsTextContent into the element's
 *                            Y.XmlFragment, ready for Tiptap collaboration.
 *
 * Reverse direction (Y.Doc → Bridge for save) lives in `yjsToBridge.ts`.
 */

const SHARED_SCALAR_FIELDS: (keyof StudioElement)[] = [
  "type", "name", "label",
  "left_in", "top_in", "width_in", "height_in",
  "left_pct", "top_pct", "width_pct", "height_pct",
  "rotation", "flip_h", "flip_v",
  "z_index", "locked", "hidden", "animation",
]

export function hydrateElement(room: YjsRoom, element: StudioElement): Y.Map<unknown> {
  let elMap = room.elements.get(element.id)
  if (!elMap) {
    elMap = new Y.Map()
    room.elements.set(element.id, elMap)
  }
  // Only set fields that aren't already shared — avoid clobbering remote edits
  // that arrived before our hydration call.
  room.doc.transact(() => {
    for (const key of SHARED_SCALAR_FIELDS) {
      if (!elMap!.has(key as string)) {
        elMap!.set(key as string, (element as unknown as Record<string, unknown>)[key as string])
      }
    }
  })
  return elMap
}

/**
 * Copy a paragraphs/runs text content into the element's Y.XmlFragment.
 * Only runs if the fragment is currently empty — once collaborative editing
 * starts, the fragment is the source of truth and we don't overwrite it.
 */
export function hydrateElementText(
  room:    YjsRoom,
  elementId: string,
  content: ParagraphsTextContent,
): Y.XmlFragment {
  // Validate the Y.Doc is still healthy. After Y.Doc.destroy() its `share`
  // map is cleared and transact() will throw — and that throw bubbles up as
  // "Cannot read properties of undefined" in production builds because of
  // y-prosemirror's internal ?. handling. Throw a clean error here so the
  // caller's try/catch can fall back to local-only.
  if (!room || !room.doc || (room.doc as unknown as { share: unknown }).share == null) {
    throw new Error("Yjs room is not in a valid state (doc destroyed or missing)")
  }
  // Use a top-level fragment keyed by element id — `doc.getXmlFragment(name)`
  // always returns an attached fragment (frag.doc === room.doc), avoiding
  // the y-tiptap "fragment.doc undefined" crash that detached fragments
  // produced under the old elMap.set('text', new Y.XmlFragment()) pattern.
  const fragName = `text:${elementId}`
  const frag = room.doc.getXmlFragment(fragName)
  if (frag.length > 0) return frag

  const schema = getSchema(bridgeExtensions())
  const pmJSON = paragraphsToTiptap(content)
  room.doc.transact(() => {
    prosemirrorJSONToYXmlFragment(schema, pmJSON, frag)
  })
  return frag
}

/**
 * Convenience: hydrate every element on a slide in one transaction so
 * collaborators don't see N separate updates as the slide loads.
 */
export function hydrateSlide(
  room:     YjsRoom,
  elements: StudioElement[],
  background_color: string | null,
): void {
  room.doc.transact(() => {
    if (!room.meta.has("background_color")) {
      room.meta.set("background_color", background_color)
    }
    for (const el of elements) {
      hydrateElement(room, el)
    }
  })
}
