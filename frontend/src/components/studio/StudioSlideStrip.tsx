interface Props {
  docId: string
  slideCount: number
  selectedSlide: number
  onSelect: (n: number) => void
}

export default function StudioSlideStrip({ docId, slideCount, selectedSlide, onSelect }: Props) {
  return (
    <div className="w-28 shrink-0 flex flex-col border-r border-edge bg-surface overflow-y-auto scrollbar-thin">
      <div className="p-2 text-[10px] text-muted uppercase tracking-widest font-semibold border-b border-edge shrink-0">
        Slides
      </div>
      <div className="flex flex-col gap-1 p-2">
        {Array.from({ length: slideCount }, (_, i) => i + 1).map((n) => {
          const active = n === selectedSlide
          return (
            <button
              key={n}
              onClick={() => onSelect(n)}
              className={[
                "flex flex-col items-center gap-1 rounded p-1 transition-all group",
                active
                  ? "ring-2 ring-accent bg-accent/10"
                  : "hover:bg-white/5",
              ].join(" ")}
            >
              <div className="w-full aspect-video bg-base rounded overflow-hidden">
                <img
                  src={`/api/docs/${docId}/slides/${n}/bridge.png`}
                  alt={`Slide ${n}`}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
              </div>
              <span className={`text-[10px] ${active ? "text-accent-light" : "text-muted"}`}>
                {n}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
