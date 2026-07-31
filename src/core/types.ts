/**
 * Shared data shapes. Everything here is plain, structured-cloneable data so it can
 * cross the sandbox/iframe boundary without ceremony.
 */

/** One frame in a document, as the sandbox sees it. */
export interface PageRef {
  id: string
  name: string
  /** Canvas position, used for the default ordering. */
  x: number
  y: number
  width: number
  height: number
}

/** A section (or an ad-hoc set of frames) that becomes one or more PDFs. */
export interface DocRef {
  id: string
  name: string
  /** The Figma canvas page this lives on, for the file-scan grouping. */
  canvasPageId: string
  canvasPageName: string
  pages: PageRef[]
  /** True when this came from a loose frame selection rather than a real section. */
  adHoc: boolean
}

export type SortMode = 'canvas' | 'alpha' | 'alpha-desc' | 'manual'

/**
 * The user's arrangement of a document. Persisted into the section's pluginData so
 * re-exporting next month keeps the same order.
 */
export interface Arrangement {
  version: 1
  sortMode: SortMode
  /** Page ids in export order. May reference nodes that no longer exist. */
  order: string[]
  /** Page ids the user struck out. */
  excluded: string[]
  /** Page ids that begin a new output PDF (a break sits *above* each of these). */
  breaks: string[]
}

export const EMPTY_ARRANGEMENT: Arrangement = {
  version: 1,
  sortMode: 'canvas',
  order: [],
  excluded: [],
  breaks: [],
}

export type StockId = 'email' | 'web' | 'print' | 'custom'

/** A quality preset, "paper stock" in the UI. */
export interface Stock {
  id: StockId
  label: string
  /** Hard cap in bytes for each output PDF, or null for no cap. */
  capBytes: number | null
  /** Target resolution for embedded images, in DPI. */
  dpi: number
  /** JPEG quality, 0-1. */
  quality: number
}

export interface ExportSettings {
  stock: StockId
  /** Only meaningful when stock === 'custom'. */
  customCapBytes: number | null
  /** Overrides from the Advanced drawer; null means "use the stock's value". */
  dpiOverride: number | null
  qualityOverride: number | null
  /** Skip images already at or below the target DPI. */
  skipSmallImages: boolean
  /** 'combined' honours break markers; 'split' emits one PDF per page. */
  output: 'combined' | 'split'
  /** Generate a PDF outline from frame names. */
  bookmarks: boolean
}

export const DEFAULT_SETTINGS: ExportSettings = {
  stock: 'email',
  customCapBytes: null,
  dpiOverride: null,
  qualityOverride: null,
  skipSmallImages: true,
  output: 'combined',
  bookmarks: true,
}

/** Resolved numeric parameters for one compression pass. */
export interface CompressionParams {
  dpi: number
  quality: number
  capBytes: number | null
  skipSmallImages: boolean
}

/** One finished file, ready to hand to the browser. */
export interface OutputFile {
  filename: string
  bytes: Uint8Array
  pageCount: number
}

/** What happened during an export, surfaced to the user rather than swallowed. */
export interface ExportReport {
  files: OutputFile[]
  /** Frames that could not be exported at all. */
  failedPages: { id: string; name: string; reason: string }[]
  /** Files still over their cap after every compression pass. */
  overCap: { filename: string; bytes: number; capBytes: number }[]
  imagesRecompressed: number
  bytesSavedByDedupe: number
  bytesSavedByImages: number
}
