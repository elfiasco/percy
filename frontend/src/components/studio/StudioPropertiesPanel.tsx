import type { StudioElement } from "../../lib/studioTypes"

const TYPE_COLOR: Record<string, string> = {
  BridgeShape:     "#6366F1",
  BridgeText:      "#22C55E",
  BridgeChart:     "#F59E0B",
  BridgeTable:     "#A855F7",
  BridgeImage:     "#EC4899",
  BridgeFreeform:  "#06B6D4",
  BridgeConnector: "#94A3B8",
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-edge/50">
      <span className="text-muted text-xs">{label}</span>
      <span className="text-slate-300 text-xs font-mono">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] text-muted uppercase tracking-widest font-semibold mb-1">{title}</div>
      {children}
    </div>
  )
}

interface Props {
  element: StudioElement | null
  slideN: number
  slideWidthIn: number
  slideHeightIn: number
}

export default function StudioPropertiesPanel({
  element, slideN, slideWidthIn, slideHeightIn,
}: Props) {
  return (
    <div className="w-64 shrink-0 border-l border-edge bg-surface flex flex-col">
      <div className="p-3 border-b border-edge shrink-0">
        <div className="text-xs font-semibold text-slate-300">Properties</div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        {!element ? (
          <div className="text-xs text-muted text-center mt-8 leading-relaxed">
            Click an element on the canvas to inspect and edit it.
          </div>
        ) : (
          <>
            {/* type badge */}
            <div className="flex items-center gap-2 mb-4">
              <div
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: TYPE_COLOR[element.type] ?? "#6366F1" }}
              />
              <span className="text-sm font-semibold text-slate-200 truncate">{element.name}</span>
            </div>

            <Section title="Identity">
              <Row label="Type"  value={element.label} />
              <Row label="ID"    value={element.id} />
              <Row label="Index" value={element.index} />
              <Row label="Z"     value={element.z_index} />
            </Section>

            <Section title="Position (in)">
              <Row label="X (left)"  value={element.left_in.toFixed(3)} />
              <Row label="Y (top)"   value={element.top_in.toFixed(3)} />
              <Row label="W (width)" value={element.width_in.toFixed(3)} />
              <Row label="H (height)"value={element.height_in.toFixed(3)} />
              {element.rotation !== 0 && (
                <Row label="Rotation" value={`${element.rotation.toFixed(1)}°`} />
              )}
            </Section>

            <Section title="Position (%)">
              <Row label="Left"   value={`${element.left_pct.toFixed(2)}%`} />
              <Row label="Top"    value={`${element.top_pct.toFixed(2)}%`} />
              <Row label="Width"  value={`${element.width_pct.toFixed(2)}%`} />
              <Row label="Height" value={`${element.height_pct.toFixed(2)}%`} />
            </Section>

            <Section title="Slide">
              <Row label="Slide"   value={slideN} />
              <Row label="W × H"   value={`${slideWidthIn.toFixed(2)}" × ${slideHeightIn.toFixed(2)}"`} />
            </Section>

            <div className="mt-2 text-[10px] text-muted leading-relaxed">
              Drag to move · Drag handles to resize · Esc to deselect
            </div>
          </>
        )}
      </div>
    </div>
  )
}
