import type { ParagraphsTextContent, ParagraphData, RunData } from "./studioTypes"

/**
 * Helpers for reading and writing text formatting on a Bridge element's
 * paragraphs/runs structure.
 *
 * Today the InlineTextEditor flattens text into single-run-per-line, so
 * "selection-level" formatting within a textbox isn't yet a thing — these
 * helpers therefore apply formatting to *every run* in the element. When
 * the rich-text editor lands, `applyFormatToRange` can be added without
 * disturbing this surface.
 */

export interface TextFormat {
  font_name?:      string | null
  font_size?:      number | null
  font_bold?:      boolean | null
  font_italic?:    boolean | null
  font_underline?: boolean | null
  font_color?:     string | null
  strikethrough?:  string | null
  font_caps?:      string | null
}

export interface ParagraphFormat {
  alignment?:    string | null
}

/** Apply text format to every run in every paragraph. */
export function applyFormatToAllRuns(
  paragraphs: ParagraphData[],
  format: TextFormat,
): ParagraphData[] {
  return paragraphs.map((p) => ({
    ...p,
    runs: p.runs.map((r) => mergeRunFormat(r, format)),
  }))
}

/** Apply paragraph-level format (alignment, etc.) to every paragraph. */
export function applyParagraphFormat(
  paragraphs: ParagraphData[],
  format: ParagraphFormat,
): ParagraphData[] {
  return paragraphs.map((p) => ({
    ...p,
    ...(format.alignment !== undefined ? { alignment: format.alignment } : {}),
  }))
}

function mergeRunFormat(run: RunData, format: TextFormat): RunData {
  const next: RunData = { ...run }
  if (format.font_name      !== undefined) next.font_name      = format.font_name
  if (format.font_size      !== undefined) next.font_size      = format.font_size
  if (format.font_bold      !== undefined) next.font_bold      = format.font_bold
  if (format.font_italic    !== undefined) next.font_italic    = format.font_italic
  if (format.font_underline !== undefined) next.font_underline = format.font_underline
  if (format.font_color     !== undefined) next.font_color     = format.font_color
  if (format.strikethrough  !== undefined) next.strikethrough  = format.strikethrough
  if (format.font_caps      !== undefined) next.font_caps      = format.font_caps
  return next
}

/**
 * Read the current "dominant" format from the element by sampling the first
 * run. Used to seed the ribbon UI so toggles reflect the current state.
 */
export function readCurrentFormat(content: ParagraphsTextContent | null): {
  text: TextFormat
  paragraph: ParagraphFormat
} {
  const para = content?.paragraphs?.[0]
  const run  = para?.runs?.[0]
  return {
    text: {
      font_name:      run?.font_name      ?? null,
      font_size:      run?.font_size      ?? null,
      font_bold:      run?.font_bold      ?? false,
      font_italic:    run?.font_italic    ?? false,
      font_underline: run?.font_underline ?? false,
      font_color:     run?.font_color     ?? null,
      strikethrough:  run?.strikethrough  ?? null,
      font_caps:      run?.font_caps      ?? null,
    },
    paragraph: {
      alignment: para?.alignment ?? null,
    },
  }
}

/** Common Microsoft-Office-default fonts plus a few system favorites. */
export const COMMON_FONTS = [
  "Calibri", "Calibri Light", "Arial", "Helvetica", "Helvetica Neue",
  "Segoe UI", "Tahoma", "Verdana", "Cambria", "Constantia", "Georgia",
  "Times New Roman", "Garamond", "Palatino", "Trebuchet MS",
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins",
  "Source Sans Pro", "IBM Plex Sans", "JetBrains Mono", "Fira Code",
  "Consolas", "Courier New",
] as const

export const COMMON_SIZES = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 96,
] as const
