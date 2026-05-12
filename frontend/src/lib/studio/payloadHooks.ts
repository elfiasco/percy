import { useEffect } from "react"
import { useStudioStore, useStudioStoreInstance } from "./store"

/** Context-aware payload hooks. Each one reads its slice of state via
 *  `useStudioStore()` (which goes through StudioStoreContext) and
 *  triggers a fetch on the SAME store instance via
 *  `useStudioStoreInstance()`. For SlideViewer the instance is a
 *  per-viewer local store pre-populated with payloads, so the cache
 *  check in loadPayload returns the data without firing the fetch
 *  (which would 404 for splash decks that have no backing doc). */

export function useStudioChartPayload(
  docId: string,
  slideN: number,
  elementId: string,
  renderKey: number,
) {
  const state = useStudioStore()
  const store = useStudioStoreInstance()
  useEffect(() => {
    void store.loadChartPayload(docId, slideN, elementId, renderKey > 0)
  }, [store, docId, slideN, elementId, renderKey])
  const payload = state.payloads[elementId]
  return {
    data: payload?.chart ?? null,
    loading: payload?.loading.chart ?? false,
    error: payload?.errors.chart ?? null,
  }
}

export function useStudioTablePayload(
  docId: string,
  slideN: number,
  elementId: string,
  renderKey: number,
) {
  const state = useStudioStore()
  const store = useStudioStoreInstance()
  useEffect(() => {
    void store.loadTablePayload(docId, slideN, elementId, renderKey > 0)
  }, [store, docId, slideN, elementId, renderKey])
  const payload = state.payloads[elementId]
  return {
    data: payload?.table ?? null,
    loading: payload?.loading.table ?? false,
    error: payload?.errors.table ?? null,
  }
}

export function useStudioTextStylePayload(
  docId: string,
  slideN: number,
  elementId: string,
  renderKey: number,
) {
  const state = useStudioStore()
  const store = useStudioStoreInstance()
  useEffect(() => {
    void store.loadTextPayload(docId, slideN, elementId, renderKey > 0)
    void store.loadStylePayload(docId, slideN, elementId, renderKey > 0)
  }, [store, docId, slideN, elementId, renderKey])
  const payload = state.payloads[elementId]
  return {
    text: payload?.text ?? null,
    style: payload?.style ?? null,
    loading: !!(payload?.loading.text || payload?.loading.style),
    error: payload?.errors.text ?? payload?.errors.style ?? null,
  }
}

export function useStudioTextPayload(
  docId: string,
  slideN: number,
  elementId: string,
  renderKey: number,
) {
  const state = useStudioStore()
  const store = useStudioStoreInstance()
  useEffect(() => {
    void store.loadTextPayload(docId, slideN, elementId, renderKey > 0)
  }, [store, docId, slideN, elementId, renderKey])
  const payload = state.payloads[elementId]
  return {
    text: payload?.text ?? null,
    loading: payload?.loading.text ?? false,
    error: payload?.errors.text ?? null,
  }
}
