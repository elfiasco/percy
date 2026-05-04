export interface StudioElement {
  id: string
  index: number
  type: string
  label: string
  name: string
  left_in: number
  top_in: number
  width_in: number
  height_in: number
  left_pct: number
  top_pct: number
  width_pct: number
  height_pct: number
  rotation: number
  z_index: number
}

export interface SlideElementsResponse {
  slide_number: number
  slide_width_in: number
  slide_height_in: number
  element_count: number
  elements: StudioElement[]
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'

export interface ElementBounds {
  left_pct: number
  top_pct: number
  width_pct: number
  height_pct: number
}
