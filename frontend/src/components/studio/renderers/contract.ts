import type { ComponentType } from "react"
import type {
  ChartData,
  ConnectorData,
  ElementStyleData,
  ParagraphsTextContent,
  StudioElement,
  TableData,
} from "../../../lib/studioTypes"
import type { StudioCommand } from "../../../lib/studio/commands"

export type StudioRendererMode = "idle" | "selected" | "editing" | "fallback"

export interface StudioRendererCapabilities {
  selectable: boolean
  transformable: boolean
  textEditable: boolean
  tableEditable: boolean
  chartEditable: boolean
  styleEditable: boolean
  nativeRenderable: boolean
  fallbackRenderable: boolean
}

export interface StudioElementPayload {
  text?: ParagraphsTextContent
  style?: ElementStyleData
  table?: TableData
  chart?: ChartData
  connector?: ConnectorData
}

export interface StudioRendererDispatch {
  runCommand: (command: StudioCommand) => void | Promise<void>
  updateElement: (elementId: string, update: Partial<StudioElement>) => void | Promise<void>
  requestEdit: (elementId: string) => void
}

export interface StudioRendererProps {
  element:   StudioElement
  payload:   StudioElementPayload
  mode:      StudioRendererMode
  selected:  boolean
  renderKey: number
  dispatch:  StudioRendererDispatch
  // Context fields needed by renderers that load their own data.
  // Renderers should prefer the pre-loaded `payload` over fetching via these.
  docId:  string
  slideN: number
}

export interface StudioRendererRegistration {
  elementType: string
  component: ComponentType<StudioRendererProps>
  capabilities: StudioRendererCapabilities
}

export const FALLBACK_RENDERER_CAPABILITIES: StudioRendererCapabilities = {
  selectable: true,
  transformable: true,
  textEditable: false,
  tableEditable: false,
  chartEditable: false,
  styleEditable: false,
  nativeRenderable: false,
  fallbackRenderable: true,
}
