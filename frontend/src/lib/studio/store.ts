import { useSyncExternalStore } from "react"
import type {
  ChartData,
  ElementStyleData,
  ElementTextContent,
  SlideElementsResponse,
  StudioElement,
  TableData,
} from "../studioTypes"
import {
  fetchChartData,
  fetchElementStyle,
  fetchElementText,
  fetchSlideElements,
  fetchTableData,
} from "../studioApi"

export type StudioPayloadKind = "text" | "style" | "chart" | "table"

export interface StudioElementPayloadState {
  text?: ElementTextContent
  style?: ElementStyleData
  chart?: ChartData
  table?: TableData
  loading: Partial<Record<StudioPayloadKind, boolean>>
  errors: Partial<Record<StudioPayloadKind, string>>
  version: number
}

export interface StudioSessionState {
  docId: string | null
  slideN: number
  slideWidthIn: number
  slideHeightIn: number
  backgroundColor: string | null
  elements: StudioElement[]
  payloads: Record<string, StudioElementPayloadState>
  selectedIds: string[]
  /** Element ID currently in inline edit mode (table cells, shape text, etc.).
      When set, the matching renderer flips to its editor. Cleared on blur or
      when another element is selected. */
  editingElementId: string | null
  renderKeys: Record<string, number>
  dirtySlides: number[]
  loading: boolean
  error: string | null
  version: number
  /** Slide number whose elements/dimensions have actually been hydrated.
      Differs from slideN during navigation: slideN updates immediately on
      click, then hydratedSlideN catches up once the API response arrives.
      The canvas exposes this as `data-hydrated-slide-n` so screenshot tests
      can wait for "the rendered content actually reflects slideN" rather
      than the click-only proxy. */
  hydratedSlideN: number
}

type Listener = () => void

const EMPTY_STATE: StudioSessionState = {
  docId: null,
  slideN: 1,
  hydratedSlideN: 0,
  slideWidthIn: 13.333,
  slideHeightIn: 7.5,
  backgroundColor: null,
  elements: [],
  payloads: {},
  selectedIds: [],
  editingElementId: null,
  renderKeys: {},
  dirtySlides: [],
  loading: false,
  error: null,
  version: 0,
}

function sortedUnique(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort()
}

function sortedUniqueNumbers(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function withDerivedPercentages(
  el: StudioElement,
  slideWidthIn: number,
  slideHeightIn: number,
): StudioElement {
  return {
    ...el,
    left_pct: slideWidthIn ? (el.left_in / slideWidthIn) * 100 : el.left_pct,
    top_pct: slideHeightIn ? (el.top_in / slideHeightIn) * 100 : el.top_pct,
    width_pct: slideWidthIn ? (el.width_in / slideWidthIn) * 100 : el.width_pct,
    height_pct: slideHeightIn ? (el.height_in / slideHeightIn) * 100 : el.height_pct,
  }
}

class StudioStore {
  private state: StudioSessionState = EMPTY_STATE
  private listeners = new Set<Listener>()
  private payloadInflight = new Map<string, Promise<unknown>>()
  // Tracks which "docId:slideN" each elementId's payload was last fetched for.
  private payloadSlide = new Map<string, string>()

  getSnapshot = (): StudioSessionState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private commit(next: StudioSessionState): void {
    this.state = { ...next, version: next.version + 1 }
    for (const listener of this.listeners) listener()
  }

  private patch(patch: Partial<StudioSessionState>): void {
    this.commit({ ...this.state, ...patch })
  }

  private payloadKey(docId: string, slideN: number, elementId: string, kind: StudioPayloadKind): string {
    return `${kind}:${docId}:${slideN}:${elementId}`
  }

  private setPayloadLoading(elementId: string, kind: StudioPayloadKind, loading: boolean, error?: string | null): void {
    const current = this.state.payloads[elementId] ?? emptyPayload()
    const errors = { ...current.errors }
    if (error === null) delete errors[kind]
    else if (error) errors[kind] = error
    this.patch({
      payloads: {
        ...this.state.payloads,
        [elementId]: {
          ...current,
          loading: { ...current.loading, [kind]: loading },
          errors,
          version: current.version + 1,
        },
      },
    })
  }

  private setPayloadData(elementId: string, patch: Partial<Omit<StudioElementPayloadState, "loading" | "errors" | "version">>): void {
    const current = this.state.payloads[elementId] ?? emptyPayload()
    const errors = { ...current.errors }
    for (const kind of Object.keys(patch) as StudioPayloadKind[]) delete errors[kind]
    this.patch({
      payloads: {
        ...this.state.payloads,
        [elementId]: {
          ...current,
          ...patch,
          loading: { ...current.loading },
          errors,
          version: current.version + 1,
        },
      },
    })
  }

  hydrateSlide(docId: string, response: SlideElementsResponse): void {
    const prevKeys = this.state.renderKeys
    const renderKeys: Record<string, number> = {}
    for (const el of response.elements) {
      renderKeys[el.id] = prevKeys[el.id] ?? 0
    }
    const slideKey = `${docId}:${response.slide_number}`
    // Drop payloads for elements whose cached slide doesn't match the incoming slide.
    // Elements share shape_id-based IDs across slides, so stale cross-slide payloads
    // would otherwise show the previous slide's content until the re-fetch completes.
    const freshPayloads = keepPayloadsForElements(this.state.payloads, response.elements)
    for (const id of Object.keys(freshPayloads)) {
      if (this.payloadSlide.get(id) !== slideKey) {
        delete freshPayloads[id]
        this.payloadSlide.delete(id)
      }
    }
    this.patch({
      docId,
      slideN: response.slide_number,
      slideWidthIn: response.slide_width_in,
      slideHeightIn: response.slide_height_in,
      backgroundColor: response.background_color,
      elements: response.elements.map((el) =>
        withDerivedPercentages(el, response.slide_width_in, response.slide_height_in),
      ),
      payloads: freshPayloads,
      renderKeys,
      selectedIds: this.state.slideN === response.slide_number ? this.state.selectedIds : [],
      loading: false,
      error: null,
      hydratedSlideN: response.slide_number,
    })
  }

  async loadSlide(docId: string, slideN: number): Promise<SlideElementsResponse> {
    // When the active slide changes, the OLD slide's elements must not stay in
    // the rendered list — otherwise a transient API failure on the new slide
    // leaves the canvas showing the previous slide's content while the URL /
    // slideN say we're on the new slide. The visible result: stale icons +
    // "! text load failed" overlays everywhere (because each old element's text
    // payload fetch hits the new slide's endpoint and 404s on the old id).
    const slideChanged = this.state.slideN !== slideN || this.state.docId !== docId
    if (slideChanged) {
      this.patch({
        docId,
        slideN,
        elements: [],         // clear stale; hydrate or error path will repopulate
        payloads: {},         // drop payloads keyed to old slide
        renderKeys: {},
        selectedIds: [],
        editingElementId: null,
        loading: true,
        error: null,
      })
    } else {
      this.patch({ docId, slideN, loading: true, error: null })
    }
    try {
      const response = await fetchSlideElements(docId, slideN)
      if (this.state.slideN === response.slide_number) {
        this.hydrateSlide(docId, response)
      }
      return response
    } catch (err) {
      this.patch({ loading: false, error: errorMessage(err) })
      throw err
    }
  }

  setSelectedIds(ids: Iterable<string>): void {
    const next = sortedUnique(ids)
    // If selection changed and an element was being edited, exit edit mode
    // unless that element is part of the new selection.
    const editing = this.state.editingElementId
    const editingStill = editing && next.includes(editing)
    this.patch({
      selectedIds: next,
      editingElementId: editingStill ? editing : null,
    })
  }

  clearSelection(): void {
    this.patch({ selectedIds: [], editingElementId: null })
  }

  selectOne(id: string | null): void {
    this.patch({
      selectedIds: id ? [id] : [],
      editingElementId: id === this.state.editingElementId ? this.state.editingElementId : null,
    })
  }

  /** Activate inline edit mode for an element (table cells, shape text, etc.).
      Renderers subscribe via `useEditingElementId()` and flip to their inline
      editor when their element id matches. Set to null to deactivate. */
  setEditingElement(id: string | null): void {
    this.patch({ editingElementId: id })
  }

  markDirty(slideN = this.state.slideN): void {
    this.patch({ dirtySlides: sortedUniqueNumbers([...this.state.dirtySlides, slideN]) })
  }

  setSlideBackground(color: string | null): void {
    this.patch({ backgroundColor: color })
  }

  bumpRenderKeys(ids: Iterable<string>): void {
    const renderKeys = { ...this.state.renderKeys }
    for (const id of ids) renderKeys[id] = (renderKeys[id] ?? 0) + 1
    this.patch({ renderKeys })
  }

  upsertElement(element: StudioElement): void {
    const normalized = withDerivedPercentages(element, this.state.slideWidthIn, this.state.slideHeightIn)
    const idx = this.state.elements.findIndex((el) => el.id === normalized.id)
    const elements = idx >= 0 ? this.state.elements.slice() : [...this.state.elements, normalized]
    if (idx >= 0) elements[idx] = normalized
    const renderKeys = { ...this.state.renderKeys, [normalized.id]: this.state.renderKeys[normalized.id] ?? 0 }
    this.patch({ elements, renderKeys })
  }

  removeElements(ids: Iterable<string>): void {
    const remove = new Set(ids)
    const renderKeys = { ...this.state.renderKeys }
    for (const id of remove) delete renderKeys[id]
    const payloads = { ...this.state.payloads }
    for (const id of remove) { delete payloads[id]; this.payloadSlide.delete(id) }
    this.patch({
      elements: this.state.elements.filter((el) => !remove.has(el.id)),
      selectedIds: this.state.selectedIds.filter((id) => !remove.has(id)),
      renderKeys,
      payloads,
    })
  }

  updateElement(id: string, fields: Partial<StudioElement>): StudioElement | null {
    let updated: StudioElement | null = null
    const elements = this.state.elements.map((el) => {
      if (el.id !== id) return el
      updated = withDerivedPercentages({ ...el, ...fields }, this.state.slideWidthIn, this.state.slideHeightIn)
      return updated
    })
    if (!updated) return null
    this.patch({ elements })
    return updated
  }

  replaceElements(elements: StudioElement[]): void {
    this.patch({
      elements: elements.map((el) => withDerivedPercentages(el, this.state.slideWidthIn, this.state.slideHeightIn)),
      payloads: keepPayloadsForElements(this.state.payloads, elements),
    })
  }

  setChartPayload(elementId: string, chart: ChartData): void {
    this.setPayloadData(elementId, { chart })
  }

  setTablePayload(elementId: string, table: TableData): void {
    this.setPayloadData(elementId, { table })
  }

  setTextPayload(elementId: string, text: ElementTextContent): void {
    this.setPayloadData(elementId, { text })
  }

  setStylePayload(elementId: string, style: ElementStyleData): void {
    this.setPayloadData(elementId, { style })
  }

  async loadChartPayload(docId: string, slideN: number, elementId: string, force = false): Promise<ChartData | null> {
    return this.loadPayload(docId, slideN, elementId, "chart", force, () => fetchChartData(docId, slideN, elementId))
  }

  async loadTablePayload(docId: string, slideN: number, elementId: string, force = false): Promise<TableData | null> {
    return this.loadPayload(docId, slideN, elementId, "table", force, () => fetchTableData(docId, slideN, elementId))
  }

  async loadTextPayload(docId: string, slideN: number, elementId: string, force = false): Promise<ElementTextContent | null> {
    return this.loadPayload(docId, slideN, elementId, "text", force, () => fetchElementText(docId, slideN, elementId))
  }

  async loadStylePayload(docId: string, slideN: number, elementId: string, force = false): Promise<ElementStyleData | null> {
    return this.loadPayload(docId, slideN, elementId, "style", force, () => fetchElementStyle(docId, slideN, elementId))
  }

  private async loadPayload<T>(
    docId: string,
    slideN: number,
    elementId: string,
    kind: StudioPayloadKind,
    force: boolean,
    loader: () => Promise<T>,
  ): Promise<T | null> {
    // Payloads are slide-specific: only use the cache when force=false AND we're on the
    // same doc+slide that the payload was fetched for (tracked via payloadSlide).
    const existing = this.state.payloads[elementId]
    const cachedSlide = this.payloadSlide.get(elementId)
    if (!force && existing && existing[kind] !== undefined && cachedSlide === `${docId}:${slideN}`) {
      return existing[kind] as T
    }

    const key = this.payloadKey(docId, slideN, elementId, kind)
    const inflight = this.payloadInflight.get(key)
    if (inflight) return inflight as Promise<T>

    this.setPayloadLoading(elementId, kind, true, null)
    const promise = loader()
      .then((data) => {
        // Discard result if the user has navigated away from this slide.
        if (this.state.docId !== docId || this.state.slideN !== slideN) return data
        this.payloadSlide.set(elementId, `${docId}:${slideN}`)
        this.setPayloadData(elementId, { [kind]: data } as Partial<Omit<StudioElementPayloadState, "loading" | "errors" | "version">>)
        this.setPayloadLoading(elementId, kind, false, null)
        return data
      })
      .catch((err) => {
        this.setPayloadLoading(elementId, kind, false, errorMessage(err))
        return null
      })
      .finally(() => {
        this.payloadInflight.delete(key)
      })
    this.payloadInflight.set(key, promise)
    return promise
  }
}

export const studioStore = new StudioStore()

export function useStudioStore(): StudioSessionState {
  return useSyncExternalStore(studioStore.subscribe, studioStore.getSnapshot, studioStore.getSnapshot)
}

export function getStudioElement(id: string): StudioElement | null {
  return studioStore.getSnapshot().elements.find((el) => el.id === id) ?? null
}

// ── Typed selectors ────────────────────────────────────────────────────────────

/** Active slide elements sorted by z_index ascending. */
export function useSlideElements(): StudioElement[] {
  const state = useStudioStore()
  return [...state.elements].sort((a, b) => a.z_index - b.z_index)
}

/** Currently selected elements (in selection order). */
export function useSelectedElements(): StudioElement[] {
  const state = useStudioStore()
  const selSet = new Set(state.selectedIds)
  return state.elements.filter((el) => selSet.has(el.id))
}

/** The single selected element, or null if zero or multiple are selected. */
export function useSelectedElement(): StudioElement | null {
  const state = useStudioStore()
  if (state.selectedIds.length !== 1) return null
  return state.elements.find((el) => el.id === state.selectedIds[0]) ?? null
}

/** Current render key for an element (bumped on any mutation). */
export function useElementRenderKey(elementId: string): number {
  const state = useStudioStore()
  return state.renderKeys[elementId] ?? 0
}

/** Element id that should be in inline edit mode, or null. */
export function useEditingElementId(): string | null {
  return useStudioStore().editingElementId
}

/** True if the slide data is currently loading. */
export function useSlideLoading(): boolean {
  return useStudioStore().loading
}

/** Active slide number. */
export function useActiveSlideN(): number {
  return useStudioStore().slideN
}

/** Slide dimensions in inches. */
export function useSlideDims(): { widthIn: number; heightIn: number } {
  const state = useStudioStore()
  return { widthIn: state.slideWidthIn, heightIn: state.slideHeightIn }
}

/** All dirty (unsaved) slide numbers. */
export function useDirtySlides(): number[] {
  return useStudioStore().dirtySlides
}

/** Payload state for a single element (loading + data). */
export function useElementPayload(elementId: string): StudioElementPayloadState | null {
  const state = useStudioStore()
  return state.payloads[elementId] ?? null
}

function emptyPayload(): StudioElementPayloadState {
  return { loading: {}, errors: {}, version: 0 }
}

function keepPayloadsForElements(
  payloads: Record<string, StudioElementPayloadState>,
  elements: StudioElement[],
): Record<string, StudioElementPayloadState> {
  const keep = new Set(elements.map((el) => el.id))
  const next: Record<string, StudioElementPayloadState> = {}
  for (const [id, payload] of Object.entries(payloads)) {
    if (keep.has(id)) next[id] = payload
  }
  return next
}
