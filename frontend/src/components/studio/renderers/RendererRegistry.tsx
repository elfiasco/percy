import type { ComponentType } from "react"
import type { StudioElement } from "../../../lib/studioTypes"
import type { StudioRendererCapabilities } from "./contract"

/**
 * Props passed to every native renderer registered in the registry.
 *
 * This is the minimal context needed by all renderers. Renderers that need
 * structured payload data (text, style, chart, table) load it via the
 * `payloadHooks` or directly from the Studio store. The full `StudioRendererProps`
 * contract (in `contract.ts`) is the "ideal" interface — these props are its
 * subset that all renderers currently consume.
 */
export interface NativeRendererProps {
  element:    StudioElement
  docId:      string
  slideN:     number
  renderKey:  number
  selected:   boolean
}

export type NativeRenderer = ComponentType<NativeRendererProps>

const REGISTRY: Map<string, NativeRenderer> = new Map()
const CAPABILITIES: Map<string, StudioRendererCapabilities> = new Map()

export function registerRenderer(
  elementType: string,
  renderer: NativeRenderer,
  capabilities?: StudioRendererCapabilities,
): void {
  REGISTRY.set(elementType, renderer)
  if (capabilities) CAPABILITIES.set(elementType, capabilities)
}

export function getRenderer(elementType: string): NativeRenderer | null {
  return REGISTRY.get(elementType) ?? null
}

export function hasRenderer(elementType: string): boolean {
  return REGISTRY.has(elementType)
}

export function getRendererCapabilities(elementType: string): StudioRendererCapabilities | null {
  return CAPABILITIES.get(elementType) ?? null
}
