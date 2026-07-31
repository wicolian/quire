import type { CompressionParams, ExportSettings, Stock, StockId } from './types'

const MB = 1024 * 1024

/**
 * The stock presets. These are the four choices the user actually makes; everything
 * else lives behind Advanced.
 *
 * Email safe is 10 MB rather than Gmail's 25 MB because the binding constraint in
 * practice is the recipient's mail server, not the sender's.
 */
export const STOCKS: Record<StockId, Stock> = {
  email: { id: 'email', label: 'Email', capBytes: 10 * MB, dpi: 150, quality: 0.82 },
  web: { id: 'web', label: 'Web', capBytes: 5 * MB, dpi: 120, quality: 0.75 },
  print: { id: 'print', label: 'Print', capBytes: null, dpi: 300, quality: 0.95 },
  custom: { id: 'custom', label: 'Custom', capBytes: null, dpi: 150, quality: 0.82 },
}

export const STOCK_ORDER: StockId[] = ['email', 'web', 'print', 'custom']

/** Resolve settings plus any Advanced overrides into concrete numbers. */
export function resolveParams(settings: ExportSettings): CompressionParams {
  const stock = STOCKS[settings.stock]
  const capBytes = settings.stock === 'custom' ? settings.customCapBytes : stock.capBytes
  return {
    dpi: settings.dpiOverride ?? stock.dpi,
    quality: settings.qualityOverride ?? stock.quality,
    capBytes: capBytes && capBytes > 0 ? capBytes : null,
    skipSmallImages: settings.skipSmallImages,
  }
}

/** How many compression attempts before giving up and asking the user. */
export const MAX_PASSES = 3

/**
 * Produce the parameters for the next pass after overshooting the cap.
 *
 * The step is proportional to how far over we are, so a file 10% over gets a gentle
 * nudge while one at triple the cap drops hard instead of creeping down over three
 * useless passes. Both axes are floored: below ~0.4 quality and ~72 DPI the output
 * stops being something you would send to a customer, and at that point the honest
 * answer is to tell the user rather than keep degrading silently.
 */
export function nextPass(
  current: CompressionParams,
  achievedBytes: number,
  capBytes: number,
): CompressionParams | null {
  const overshoot = achievedBytes / capBytes
  if (overshoot <= 1) return null

  const aggression = Math.min(0.55, 0.18 * Math.log2(overshoot) + 0.12)
  const quality = Math.max(0.4, current.quality * (1 - aggression))
  const dpi = Math.max(72, Math.round(current.dpi * (1 - aggression * 0.6)))

  // If neither axis can move any further, another pass would burn time for nothing.
  if (quality >= current.quality - 0.005 && dpi >= current.dpi) return null

  return { ...current, quality, dpi }
}

/**
 * Rough size estimate shown in the UI before the user commits to an export.
 *
 * This is deliberately crude — the honest number only exists after a real merge. It
 * exists so the gauge is not empty on first open, and it is replaced by the measured
 * size the moment an export finishes.
 */
export function estimateBytes(
  pageCount: number,
  imageCount: number,
  params: CompressionParams,
): number {
  // A vector-and-text A4 page out of Figma lands around 90 KB before dedupe.
  const vectorPerPage = 92 * 1024
  // A full-bleed A4 image at the target DPI, JPEG-encoded at the target quality.
  const megapixels = ((params.dpi * 8.27) * (params.dpi * 11.69)) / 1_000_000
  const perImage = megapixels * 1024 * 90 * params.quality
  return Math.round(pageCount * vectorPerPage + imageCount * perImage)
}

/** Parse a user-typed MB value into bytes. Returns null for anything unusable. */
export function parseMegabytes(input: string): number | null {
  const value = Number.parseFloat(input.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * MB)
}
