import type { StudioCommand } from "./commands"
import { openModal, closeModal, toggleModal, isModalOpen } from "./modalRegistry"

export { openModal, closeModal, toggleModal, isModalOpen }

export type StudioToolSurface = "ribbon" | "command-palette" | "context-menu" | "modal"

export interface StudioToolDefinition {
  id: string
  label: string
  icon: string
  keywords: string[]
  surfaces: StudioToolSurface[]
  commandId?: string
  modalId?: string
}

export const CORE_STUDIO_COMMANDS: StudioCommand[] = [
  {
    id: "studio.selection.clear",
    label: "Clear Selection",
    icon: "Esc",
    keywords: ["clear", "selection", "deselect"],
    scope: "selection",
    isEnabled: (ctx) => ctx.selectedIds.length > 0,
    run: async () => {
      const { studioStore } = await import("./store")
      studioStore.clearSelection()
    },
  },
  {
    id: "studio.undo",
    label: "Undo",
    icon: "↩",
    keywords: ["undo", "revert"],
    scope: "deck",
    run: async () => {
      const { undoHistory } = await import("./undoHistory")
      if (undoHistory.canUndo()) await undoHistory.undo()
    },
  },
  {
    id: "studio.redo",
    label: "Redo",
    icon: "↪",
    keywords: ["redo", "repeat"],
    scope: "deck",
    run: async () => {
      const { undoHistory } = await import("./undoHistory")
      if (undoHistory.canRedo()) await undoHistory.redo()
    },
  },
]

export const CORE_STUDIO_TOOLS: StudioToolDefinition[] = [
  {
    id: "studio.tool.select",
    label: "Select",
    icon: "Pointer",
    keywords: ["select", "pointer", "move"],
    surfaces: ["ribbon", "command-palette"],
  },
  {
    id: "studio.tool.text",
    label: "Text Box",
    icon: "T",
    keywords: ["text", "textbox", "insert"],
    surfaces: ["ribbon", "command-palette"],
  },
  {
    id: "studio.tool.table",
    label: "Table",
    icon: "Table",
    keywords: ["table", "grid", "cells"],
    surfaces: ["ribbon", "command-palette"],
  },
  {
    id: "studio.tool.chart",
    label: "Chart",
    icon: "Chart",
    keywords: ["chart", "data", "graph"],
    surfaces: ["ribbon", "command-palette"],
  },
]

export function findStudioCommand(id: string): StudioCommand | null {
  return CORE_STUDIO_COMMANDS.find((command) => command.id === id) ?? null
}
