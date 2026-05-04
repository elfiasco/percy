import type { SlideElementsResponse, StudioElement } from "./studioTypes"

const BASE = "/api"

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

export async function fetchSlideElements(docId: string, slideN: number): Promise<SlideElementsResponse> {
  return apiFetch<SlideElementsResponse>(`${BASE}/docs/${docId}/slides/${slideN}/elements`)
}

export async function updateElementPosition(
  docId: string,
  slideN: number,
  elementId: string,
  update: { left_in?: number; top_in?: number; width_in?: number; height_in?: number },
): Promise<StudioElement> {
  return apiFetch<StudioElement>(
    `${BASE}/docs/${docId}/slides/${slideN}/elements/${encodeURIComponent(elementId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    },
  )
}
