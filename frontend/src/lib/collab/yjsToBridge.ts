import type * as Y from "yjs"
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror"
import type { ParagraphsTextContent } from "../studioTypes"
import { tiptapToParagraphs } from "../bridge/tiptapAdapter"
import type { YjsRoom } from "./yjsRoom"

/**
 * Y.Doc → Bridge serialization.
 *
 * Used at save time to lift the live collaborative state back into the
 * canonical Bridge JSON the backend expects. After this round-trip, the
 * Y.Doc and the persisted Bridge JSON describe the same content.
 *
 * Round-trip identity:
 *   bridge → hydrate → Y.Doc → save → bridge
 * should be lossless modulo run-merging (adjacent runs with identical
 * formatting are coalesced; that's a feature, not a bug).
 */

export function elementTextFromYjs(
  room:      YjsRoom,
  elementId: string,
): ParagraphsTextContent | null {
  const elMap = room.elements.get(elementId)
  if (!elMap) return null
  const frag = elMap.get("text") as Y.XmlFragment | undefined
  if (!frag) return null

  const pmJSON = yXmlFragmentToProsemirrorJSON(frag)
  return tiptapToParagraphs(pmJSON)
}

export function elementFieldsFromYjs(
  room:      YjsRoom,
  elementId: string,
): Record<string, unknown> | null {
  const elMap = room.elements.get(elementId)
  if (!elMap) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of elMap.entries()) {
    if (k === "text") continue   // text handled separately
    out[k] = v
  }
  return out
}
