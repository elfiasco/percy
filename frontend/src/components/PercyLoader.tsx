import "./PercyLoader.css"
import {
  PERCY_VIEWBOX,
  PERCY_SILHOUETTE_D,
  PERCY_BOWL_POLY,
  PERCY_SLASH_POLY,
  PERCY_BOWL_CENTERLINE,
  PERCY_SLASH_CENTERLINE,
  PERCY_BOWL_MAX_WIDTH,
  PERCY_SLASH_MAX_WIDTH,
  PERCY_BOWL_RESIDUALS,
  PERCY_SLASH_RESIDUALS,
} from "./percy-mark-paths"

/**
 * PercyLoader — animates the actual hand-drawn percy-mark, pixel-perfect.
 *
 * The mark is decomposed by trace_mark.py into:
 *
 *   • Two FILLED variable-width polygons (bowl + slash) — the smooth
 *     mathematical representation of the mark's centerlines + thickness
 *     functions. Captures most of the mark with two paths.
 *
 *   • A handful of residual "patch" strokes — small uniform-width lines
 *     covering the last few percent where uniform-segment math under-fits.
 *
 *   • The verbatim original silhouette as a clipPath, ensuring nothing
 *     ever renders outside the actual hand-drawn outline.
 *
 * Animation: each polygon is revealed progressively by a thick stroked
 * centerline animating inside its mask. As the centerline draws on, the
 * polygon under it becomes visible. Residuals animate with their phase.
 *
 *   Phase 1 (0–700ms)   bowl polygon reveals along the centerline
 *   Phase 2 (850–1100ms) slash polygon strikes through
 *   Phase 3 (~1100ms)   impact pulse
 *   Phase 4 (1700ms+)   ambient breath, infinite loop
 */

interface Props {
  size?: number
  className?: string
  replayKey?: string | number
}

let _idCounter = 0

export default function PercyLoader({
  size = 64,
  className = "",
  replayKey,
}: Props) {
  const n = ++_idCounter
  const clipId      = `percy-clip-${n}`
  const bowlMaskId  = `percy-bowl-mask-${n}`
  const slashMaskId = `percy-slash-mask-${n}`

  // Mask stroke widths must exceed the polygons' max widths so the mask
  // covers them entirely as the centerline draws on.
  const bowlMaskW  = Math.max(PERCY_BOWL_MAX_WIDTH  * 1.2, 80)
  const slashMaskW = Math.max(PERCY_SLASH_MAX_WIDTH * 1.2, 80)

  return (
    <svg
      key={replayKey}
      className={`percy-loader ${className}`.trim()}
      width={size}
      height={size}
      viewBox={PERCY_VIEWBOX}
      role="img"
      aria-label="Loading"
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <path d={PERCY_SILHOUETTE_D} fillRule="evenodd" />
        </clipPath>

        <mask id={bowlMaskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
          <path
            className="percy-loader__bowl-mask-stroke"
            d={PERCY_BOWL_CENTERLINE.d}
            fill="none"
            stroke="white"
            strokeWidth={bowlMaskW}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={100}
          />
        </mask>

        <mask id={slashMaskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
          <path
            className="percy-loader__slash-mask-stroke"
            d={PERCY_SLASH_CENTERLINE.d}
            fill="none"
            stroke="white"
            strokeWidth={slashMaskW}
            strokeLinecap="round"
            pathLength={100}
          />
        </mask>
      </defs>

      <g className="percy-loader__breath">
        <g className="percy-loader__impact" clipPath={`url(#${clipId})`}>
          {/* Bowl polygon, masked to reveal as bowl centerline draws on */}
          <g mask={`url(#${bowlMaskId})`}>
            <path
              className="percy-loader__bowl-poly"
              fill="currentColor"
              d={PERCY_BOWL_POLY.d}
            />
            {PERCY_BOWL_RESIDUALS.map((p, i) => (
              <path
                key={`br${i}`}
                className="percy-loader__bowl-residual"
                fill="none"
                stroke="currentColor"
                strokeWidth={p.w}
                strokeLinecap="round"
                d={p.d}
              />
            ))}
          </g>

          {/* Slash polygon, masked to reveal as slash centerline strikes */}
          <g mask={`url(#${slashMaskId})`}>
            <path
              className="percy-loader__slash-poly"
              fill="currentColor"
              d={PERCY_SLASH_POLY.d}
            />
            {PERCY_SLASH_RESIDUALS.map((p, i) => (
              <path
                key={`sr${i}`}
                className="percy-loader__slash-residual"
                fill="none"
                stroke="currentColor"
                strokeWidth={p.w}
                strokeLinecap="round"
                d={p.d}
              />
            ))}
          </g>
        </g>
      </g>
    </svg>
  )
}
