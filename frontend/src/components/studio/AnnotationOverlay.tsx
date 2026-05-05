import { useState, useRef, useCallback, useEffect } from "react"

interface Annotation {
  id: string
  type: "pen" | "arrow" | "circle" | "rect" | "text"
  color: string
  points?: number[][]     // for pen
  x1?: number; y1?: number; x2?: number; y2?: number  // for arrow/circle/rect
  text?: string; x?: number; y?: number               // for text
  strokeWidth: number
}

interface Props {
  slideN: number
  onClose: () => void
}

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ffffff", "#000000"]

function genId() { return `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }

export default function AnnotationOverlay({ slideN, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tool, setTool]     = useState<Annotation["type"]>("pen")
  const [color, setColor]   = useState("#ef4444")
  const [strokeW, setStrokeW] = useState(3)
  const [annotations, setAnnotations] = useState<Map<number, Annotation[]>>(new Map())
  const [drawing, setDrawing] = useState(false)
  const [current, setCurrent] = useState<Annotation | null>(null)
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null)
  const [textVal, setTextVal] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const getAnns = useCallback((n: number) => annotations.get(n) ?? [], [annotations])
  const setAnns = useCallback((n: number, anns: Annotation[]) => {
    setAnnotations((prev) => { const m = new Map(prev); m.set(n, anns); return m })
  }, [])

  const getSVGPoint = (e: React.MouseEvent<SVGSVGElement>): [number, number] => {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    return [
      ((e.clientX - rect.left) / rect.width) * 100,
      ((e.clientY - rect.top) / rect.height) * 100,
    ]
  }

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool === "text") {
      const [x, y] = getSVGPoint(e)
      setTextInput({ x, y })
      setTextVal("")
      setTimeout(() => inputRef.current?.focus(), 50)
      return
    }
    const [x, y] = getSVGPoint(e)
    const ann: Annotation = { id: genId(), type: tool, color, strokeWidth: strokeW }
    if (tool === "pen") {
      ann.points = [[x, y]]
    } else {
      ann.x1 = x; ann.y1 = y; ann.x2 = x; ann.y2 = y
    }
    setCurrent(ann)
    setDrawing(true)
  }

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawing || !current) return
    const [x, y] = getSVGPoint(e)
    if (current.type === "pen") {
      setCurrent((c) => c ? { ...c, points: [...(c.points ?? []), [x, y]] } : null)
    } else {
      setCurrent((c) => c ? { ...c, x2: x, y2: y } : null)
    }
  }

  const onMouseUp = () => {
    if (!drawing || !current) return
    setDrawing(false)
    setAnns(slideN, [...getAnns(slideN), current])
    setCurrent(null)
  }

  const commitText = () => {
    if (textInput && textVal.trim()) {
      const ann: Annotation = {
        id: genId(), type: "text", color, strokeWidth: strokeW,
        x: textInput.x, y: textInput.y, text: textVal.trim(),
      }
      setAnns(slideN, [...getAnns(slideN), ann])
    }
    setTextInput(null)
    setTextVal("")
  }

  const undo = () => {
    const anns = getAnns(slideN)
    if (anns.length > 0) setAnns(slideN, anns.slice(0, -1))
  }

  const clearSlide = () => setAnns(slideN, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo() }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [annotations, slideN]) // eslint-disable-line react-hooks/exhaustive-deps

  const renderAnn = (ann: Annotation) => {
    const common = { key: ann.id, stroke: ann.color, strokeWidth: ann.strokeWidth, fill: "none" }
    switch (ann.type) {
      case "pen":
        if (!ann.points || ann.points.length < 2) return null
        return <polyline {...common} points={ann.points.map(([x, y]) => `${x},${y}`).join(" ")} strokeLinecap="round" strokeLinejoin="round" />
      case "arrow": {
        if (ann.x1 == null) return null
        const dx = (ann.x2! - ann.x1) * 0.15
        const dy = (ann.y2! - ann.y1) * 0.15
        return (
          <g key={ann.id}>
            <line x1={ann.x1} y1={ann.y1} x2={ann.x2} y2={ann.y2} stroke={ann.color} strokeWidth={ann.strokeWidth} />
            <line x1={ann.x2} y1={ann.y2} x2={ann.x2! - dx - dy * 0.5} y2={ann.y2! - dy + dx * 0.5} stroke={ann.color} strokeWidth={ann.strokeWidth} />
            <line x1={ann.x2} y1={ann.y2} x2={ann.x2! - dx + dy * 0.5} y2={ann.y2! - dy - dx * 0.5} stroke={ann.color} strokeWidth={ann.strokeWidth} />
          </g>
        )
      }
      case "circle": {
        if (ann.x1 == null) return null
        const rx = Math.abs((ann.x2! - ann.x1) / 2)
        const ry = Math.abs((ann.y2! - ann.y1) / 2)
        const cx = (ann.x1 + ann.x2!) / 2
        const cy = (ann.y1! + ann.y2!) / 2
        return <ellipse key={ann.id} cx={cx} cy={cy} rx={rx} ry={ry} stroke={ann.color} strokeWidth={ann.strokeWidth} fill="none" />
      }
      case "rect":
        if (ann.x1 == null) return null
        return <rect key={ann.id} x={Math.min(ann.x1, ann.x2!)} y={Math.min(ann.y1!, ann.y2!)} width={Math.abs(ann.x2! - ann.x1)} height={Math.abs(ann.y2! - ann.y1!)} stroke={ann.color} strokeWidth={ann.strokeWidth} fill="none" />
      case "text":
        return (
          <text key={ann.id} x={ann.x} y={ann.y} fill={ann.color} fontSize={4} fontFamily="sans-serif" stroke="rgba(0,0,0,0.5)" strokeWidth={0.2} paintOrder="stroke">
            {ann.text}
          </text>
        )
      default: return null
    }
  }

  const allAnns = getAnns(slideN)
  const totalCount = Array.from(annotations.values()).reduce((a, b) => a + b.length, 0)

  const TOOLS: { id: Annotation["type"]; label: string; icon: string }[] = [
    { id: "pen",    label: "Pen",    icon: "✏" },
    { id: "arrow",  label: "Arrow",  icon: "↗" },
    { id: "circle", label: "Circle", icon: "○" },
    { id: "rect",   label: "Rect",   icon: "□" },
    { id: "text",   label: "Text",   icon: "T" },
  ]

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      {/* SVG layer */}
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full pointer-events-auto"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: tool === "text" ? "text" : "crosshair" }}
      >
        {allAnns.map(renderAnn)}
        {current && renderAnn(current)}
      </svg>

      {/* text input */}
      {textInput && (
        <div
          className="absolute pointer-events-auto"
          style={{ left: `${textInput.x}%`, top: `${textInput.y}%`, transform: "translate(-50%, -100%)" }}
        >
          <input
            ref={inputRef}
            value={textVal}
            onChange={(e) => setTextVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitText(); if (e.key === "Escape") { setTextInput(null); setTextVal("") } }}
            onBlur={commitText}
            className="bg-black/80 border border-white/30 text-white text-xs px-2 py-1 rounded focus:outline-none min-w-[80px]"
            placeholder="Type annotation…"
            style={{ color }}
          />
        </div>
      )}

      {/* toolbar */}
      <div className="absolute top-3 right-3 pointer-events-auto flex flex-col gap-1.5 bg-[#1e1e2e]/90 border border-white/10 rounded-xl p-2 shadow-xl backdrop-blur-sm">
        {/* tools */}
        <div className="flex gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={t.label}
              onClick={() => setTool(t.id)}
              className={`w-7 h-7 rounded text-sm flex items-center justify-center transition-colors ${tool === t.id ? "bg-accent/20 text-accent" : "text-white/50 hover:text-white hover:bg-white/10"}`}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <div className="w-full h-px bg-white/10" />

        {/* colors */}
        <div className="flex flex-wrap gap-1 max-w-[140px]">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border-2 transition-all ${color === c ? "border-white scale-110" : "border-transparent"}`}
              style={{ background: c }}
            />
          ))}
        </div>

        <div className="w-full h-px bg-white/10" />

        {/* stroke width */}
        <div className="flex items-center gap-1.5 px-0.5">
          <span className="text-white/30 text-[9px]">W</span>
          <input
            type="range" min={1} max={8} value={strokeW}
            onChange={(e) => setStrokeW(parseInt(e.target.value))}
            className="flex-1 h-1 accent-accent"
          />
          <span className="text-white/30 text-[9px] w-4">{strokeW}</span>
        </div>

        <div className="w-full h-px bg-white/10" />

        {/* actions */}
        <div className="flex gap-1">
          <button
            title="Undo (Ctrl+Z)"
            onClick={undo}
            disabled={allAnns.length === 0}
            className="flex-1 py-1 rounded text-[11px] text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
          >
            ↩
          </button>
          <button
            title="Clear slide"
            onClick={clearSlide}
            disabled={allAnns.length === 0}
            className="flex-1 py-1 rounded text-[11px] text-red-400/60 hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30 transition-colors"
          >
            ✕
          </button>
          <button
            title="Close annotations"
            onClick={onClose}
            className="flex-1 py-1 rounded text-[11px] text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            ✓
          </button>
        </div>

        {totalCount > 0 && (
          <div className="text-[9px] text-white/20 text-center">{totalCount} annotation{totalCount !== 1 ? "s" : ""}</div>
        )}
      </div>
    </div>
  )
}
