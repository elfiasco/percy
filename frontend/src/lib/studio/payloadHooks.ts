import { useEffect } from "react"
import { studioStore, useStudioStore } from "./store"

export function useStudioChartPayload(
  docId: string,
  slideN: number,
  elementId: string,
  renderKey: number,
) {
  const state = useStudioStore()
  useEffect(() => {
    void studioStore.loadChartPayload(docId, slideN, elementId, renderKey > 0)
  }, [docId, slideN, elementId, renderKey])
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
  useEffect(() => {
    void studioStore.loadTablePayload(docId, slideN, elementId, renderKey > 0)
  }, [docId, slideN, elementId, renderKey])
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
  useEffect(() => {
    void studioStore.loadTextPayload(docId, slideN, elementId, renderKey > 0)
    void studioStore.loadStylePayload(docId, slideN, elementId, renderKey > 0)
  }, [docId, slideN, elementId, renderKey])
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
  useEffect(() => {
    void studioStore.loadTextPayload(docId, slideN, elementId, renderKey > 0)
  }, [docId, slideN, elementId, renderKey])
  const payload = state.payloads[elementId]
  return {
    text: payload?.text ?? null,
    loading: payload?.loading.text ?? false,
    error: payload?.errors.text ?? null,
  }
}
