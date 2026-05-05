import type { ComponentType } from "react"
import type { StudioElement } from "../../../lib/studioTypes"

export interface NativeRendererProps {
  element:    StudioElement
  docId:      string
  slideN:     number
  renderKey:  number
  selected:   boolean
}

export type NativeRenderer = ComponentType<NativeRendererProps>

const REGISTRY: Map<string, NativeRenderer> = new Map()

export function registerRenderer(elementType: string, renderer: NativeRenderer): void {
  REGISTRY.set(elementType, renderer)
}

export function getRenderer(elementType: string): NativeRenderer | null {
  return REGISTRY.get(elementType) ?? null
}

export function hasRenderer(elementType: string): boolean {
  return REGISTRY.has(elementType)
}
