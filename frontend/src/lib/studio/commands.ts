import type {
  ChartData,
  ChartDataUpdate,
  ElementStyleData,
  ElementStyleUpdate,
  StudioElement,
  TableData,
  TableDataUpdate,
} from "../studioTypes"
import {
  updateChartData,
  updateElementFlags as updateElementFlagsApi,
  updateElementPosition,
  updateElementStyle,
  updateTableData,
} from "../studioApi"
import { getCollabContext } from "../collab/collabContext"
import {
  bumpRev,
  patchElementStyleData,
  setElementChartData,
  setElementTableData,
  updateElementFields,
} from "../collab/bridgeYjsAdapter"
import { studioStore } from "./store"
import { undoHistory } from "./undoHistory"

export type ElementGeometryUpdate = {
  left_in?: number
  top_in?: number
  width_in?: number
  height_in?: number
  z_index?: number
  rotation?: number
  flip_h?: boolean
  flip_v?: boolean
  locked?: boolean
  hidden?: boolean
  animation?: string
  name?: string
}

export type StudioCommandScope = "deck" | "slide" | "element" | "selection" | "table" | "chart" | "text"

export interface StudioCommandContext {
  docId: string
  slideN: number
  selectedIds: string[]
  selectedElement: StudioElement | null
}

export interface StudioCommand {
  id: string
  label: string
  icon: string
  keywords: string[]
  scope: StudioCommandScope
  isEnabled?: (ctx: StudioCommandContext) => boolean
  run: (ctx: StudioCommandContext) => void | Promise<void>
}

function currentDocSlide(): { docId: string; slideN: number } | null {
  const state = studioStore.getSnapshot()
  if (!state.docId) return null
  return { docId: state.docId, slideN: state.slideN }
}

function writeGeometryToYjs(id: string, update: ElementGeometryUpdate): void {
  const collab = getCollabContext()
  if (!collab?.enabled || !collab.room) return
  try {
    updateElementFields(collab.room, id, update)
  } catch (err) {
    console.warn("[Percy] Studio 2.0 geometry Yjs write failed:", err)
  }
}

function writeStyleToYjs(id: string, update: ElementStyleUpdate): void {
  const collab = getCollabContext()
  if (!collab?.enabled || !collab.room) return
  try {
    patchElementStyleData(collab.room, id, update)
  } catch (err) {
    console.warn("[Percy] Studio 2.0 style Yjs write failed:", err)
    // Fallback: at least bump the rev so peers know to re-fetch.
    try { bumpRev(collab.room, id, "style_rev") } catch { /* ignore */ }
  }
}

function bumpRenderRev(id: string): void {
  const collab = getCollabContext()
  if (!collab?.enabled || !collab.room) return
  try {
    bumpRev(collab.room, id, "render_rev")
  } catch (err) {
    console.warn("[Percy] Studio 2.0 render Yjs rev bump failed:", err)
  }
}

function writeChartToYjs(id: string, data: ChartData): void {
  const collab = getCollabContext()
  if (!collab?.enabled || !collab.room) return
  try {
    setElementChartData(collab.room, id, data)
  } catch (err) {
    console.warn("[Percy] Studio 2.0 chart Yjs write failed:", err)
    try { bumpRev(collab.room, id, "render_rev") } catch { /* ignore */ }
  }
}

function writeTableToYjs(id: string, data: unknown): void {
  const collab = getCollabContext()
  if (!collab?.enabled || !collab.room) return
  try {
    setElementTableData(collab.room, id, data)
  } catch (err) {
    console.warn("[Percy] Studio 2.0 table Yjs write failed:", err)
    try { bumpRev(collab.room, id, "render_rev") } catch { /* ignore */ }
  }
}

export async function commitElementGeometry(
  id: string,
  update: ElementGeometryUpdate,
  opts: { skipHistory?: boolean } = {},
): Promise<StudioElement | null> {
  const target = currentDocSlide()
  if (!target) return null

  // Capture prev state for undo before applying the update.
  const prevElement = studioStore.getSnapshot().elements.find((el) => el.id === id)
  const prevGeom: ElementGeometryUpdate | null = prevElement ? {
    left_in:   prevElement.left_in,
    top_in:    prevElement.top_in,
    width_in:  prevElement.width_in,
    height_in: prevElement.height_in,
    rotation:  prevElement.rotation,
    flip_h:    prevElement.flip_h,
    flip_v:    prevElement.flip_v,
    z_index:   prevElement.z_index,
    locked:    prevElement.locked,
    hidden:    prevElement.hidden,
  } : null

  const local = studioStore.updateElement(id, update)
  writeGeometryToYjs(id, update)
  studioStore.markDirty(target.slideN)

  if (!opts.skipHistory && prevGeom) {
    undoHistory.push({
      label: "Move/Resize",
      undo: () => commitElementGeometry(id, prevGeom, { skipHistory: true }),
      redo: () => commitElementGeometry(id, update, { skipHistory: true }),
    })
  }

  try {
    const updated = await updateElementPosition(target.docId, target.slideN, id, update)
    studioStore.upsertElement(updated)
    return updated
  } catch (err) {
    console.error("[Percy] geometry persistence failed:", err)
    return local
  }
}

export async function commitElementFlags(
  id: string,
  flags: { locked?: boolean; hidden?: boolean },
): Promise<StudioElement | null> {
  const target = currentDocSlide()
  if (!target) return null
  const local = studioStore.updateElement(id, flags)
  writeGeometryToYjs(id, flags)
  studioStore.markDirty(target.slideN)

  try {
    const updated = await updateElementFlagsApi(target.docId, target.slideN, id, flags)
    studioStore.upsertElement(updated)
    return updated
  } catch (err) {
    console.error("[Percy] flag persistence failed:", err)
    return local
  }
}

export async function commitElementStyle(
  id: string,
  update: ElementStyleUpdate,
  opts: { skipHistory?: boolean } = {},
): Promise<void> {
  const target = currentDocSlide()
  if (!target) return

  const prevStyle: ElementStyleData | undefined = studioStore.getSnapshot().payloads[id]?.style

  writeStyleToYjs(id, update)
  studioStore.bumpRenderKeys([id])
  studioStore.markDirty(target.slideN)

  if (!opts.skipHistory && prevStyle) {
    // Build a reverse update from the previous style snapshot.
    const reverseUpdate: ElementStyleUpdate = {}
    for (const key of Object.keys(update) as (keyof ElementStyleUpdate)[]) {
      ;(reverseUpdate as Record<string, unknown>)[key] = (prevStyle as Record<string, unknown>)[key] ?? null
    }
    undoHistory.push({
      label: "Style Change",
      undo: () => commitElementStyle(id, reverseUpdate, { skipHistory: true }),
      redo: () => commitElementStyle(id, update, { skipHistory: true }),
    })
  }

  try {
    const style = await updateElementStyle(target.docId, target.slideN, id, update)
    studioStore.setStylePayload(id, style)
  } catch (err) {
    console.error("[Percy] style persistence failed:", err)
  }
}

export async function commitChartData(
  id: string,
  update: ChartDataUpdate,
  opts: { skipHistory?: boolean } = {},
): Promise<ChartData | null> {
  const target = currentDocSlide()
  if (!target) return null

  const prevChart = studioStore.getSnapshot().payloads[id]?.chart

  studioStore.bumpRenderKeys([id])
  studioStore.markDirty(target.slideN)

  try {
    const data = await updateChartData(target.docId, target.slideN, id, update)
    studioStore.setChartPayload(id, data)
    writeChartToYjs(id, data)
    studioStore.bumpRenderKeys([id])

    if (!opts.skipHistory && prevChart) {
      const prevUpdate: ChartDataUpdate = prevChart as unknown as ChartDataUpdate
      undoHistory.push({
        label: "Edit Chart",
        undo: () => commitChartData(id, prevUpdate, { skipHistory: true }),
        redo: () => commitChartData(id, update, { skipHistory: true }),
      })
    }
    return data
  } catch (err) {
    console.error("[Percy] chart persistence failed:", err)
    return null
  }
}

export async function commitTableData(
  id: string,
  update: TableDataUpdate,
  opts: { skipHistory?: boolean } = {},
): Promise<TableData | null> {
  const target = currentDocSlide()
  if (!target) return null

  const prevTable = studioStore.getSnapshot().payloads[id]?.table

  studioStore.bumpRenderKeys([id])
  studioStore.markDirty(target.slideN)

  try {
    const data = await updateTableData(target.docId, target.slideN, id, update)
    studioStore.setTablePayload(id, data)
    writeTableToYjs(id, data)
    studioStore.bumpRenderKeys([id])

    if (!opts.skipHistory && prevTable) {
      const prevUpdate: TableDataUpdate = prevTable as unknown as TableDataUpdate
      undoHistory.push({
        label: "Edit Table",
        undo: () => commitTableData(id, prevUpdate, { skipHistory: true }),
        redo: () => commitTableData(id, update, { skipHistory: true }),
      })
    }
    return data
  } catch (err) {
    console.error("[Percy] table persistence failed:", err)
    return null
  }
}

export function makeCommandContext(): StudioCommandContext | null {
  const state = studioStore.getSnapshot()
  if (!state.docId) return null
  const selectedElement = state.selectedIds.length === 1
    ? state.elements.find((el) => el.id === state.selectedIds[0]) ?? null
    : null
  return {
    docId: state.docId,
    slideN: state.slideN,
    selectedIds: state.selectedIds,
    selectedElement,
  }
}
