import { useState, useEffect } from "react"
import type { DocInfo } from "../../lib/types"
import type { StudioElement } from "../../lib/studioTypes"
import { fetchSlideElements } from "../../lib/studioApi"
import StudioSlideStrip from "./StudioSlideStrip"
import StudioCanvas from "./StudioCanvas"
import StudioPropertiesPanel from "./StudioPropertiesPanel"

interface Props {
  doc: DocInfo
}

export default function Studio({ doc }: Props) {
  const [selectedSlide, setSelectedSlide]     = useState(1)
  const [selectedElement, setSelectedElement] = useState<StudioElement | null>(null)
  const [slideWidthIn, setSlideWidthIn]       = useState(13.333)
  const [slideHeightIn, setSlideHeightIn]     = useState(7.5)

  // Fetch slide dimensions whenever the slide changes
  useEffect(() => {
    fetchSlideElements(doc.doc_id, selectedSlide)
      .then((res) => {
        setSlideWidthIn(res.slide_width_in)
        setSlideHeightIn(res.slide_height_in)
      })
      .catch(() => {})
  }, [doc.doc_id, selectedSlide])

  return (
    <div className="flex flex-1 min-h-0 min-w-0">
      <StudioSlideStrip
        docId={doc.doc_id}
        slideCount={doc.slide_count}
        selectedSlide={selectedSlide}
        onSelect={(n) => { setSelectedSlide(n); setSelectedElement(null) }}
      />

      <StudioCanvas
        docId={doc.doc_id}
        slideN={selectedSlide}
        slideWidthIn={slideWidthIn}
        slideHeightIn={slideHeightIn}
        onSelectElement={setSelectedElement}
      />

      <StudioPropertiesPanel
        element={selectedElement}
        slideN={selectedSlide}
        slideWidthIn={slideWidthIn}
        slideHeightIn={slideHeightIn}
      />
    </div>
  )
}
