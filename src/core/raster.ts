import { PDFDocument } from 'pdf-lib'
import type { ImageCodec } from './adapters/codec'
import { addOutline } from './bookmarks'
import type { PageRef } from './types'

/**
 * The raster fallback: flatten pages to images when nothing else will fit the cap.
 *
 * The obvious implementation — rasterize the merged PDF — would mean shipping a full
 * PDF renderer in the plugin bundle. Instead the frames are re-exported from Figma as
 * JPEGs, which Figma renders far better than any JS renderer would, and those become
 * the pages.
 *
 * This is lossy in a way the user must opt into explicitly: text stops being text.
 * Nothing in this file runs unless they press the button that says so.
 */

export interface RasterInput {
  docName: string
  pages: PageRef[]
  /** Page id → JPEG bytes exported from Figma at `scale`. */
  images: Map<string, Uint8Array>
  /** Export scale used, so page boxes can be sized back to their original points. */
  scale: number
  quality: number
  bookmarks: boolean
  codec: ImageCodec
  onProgress?: (done: number, total: number) => void
}

/**
 * Re-encode at the target quality and assemble.
 *
 * Figma's own JPEG export quality is not adjustable, so its output is decoded and
 * re-encoded here. That is one extra generation of loss, but it is the only way to
 * actually steer file size, which is the entire point of choosing this path.
 */
export async function buildRasterPdf(input: RasterInput): Promise<Uint8Array | null> {
  const doc = await PDFDocument.create()
  const titles: string[] = []
  let done = 0

  for (const page of input.pages) {
    const source = input.images.get(page.id)
    done++
    input.onProgress?.(done, input.pages.length)
    if (!source) continue

    let bytes = source
    try {
      const decoded = await input.codec.decodeJpeg(source)
      const reencoded = await input.codec.encodeJpeg(decoded, input.quality)
      // Only take the re-encoded version if it actually helped.
      if (reencoded.length < source.length) bytes = reencoded
    } catch {
      // Fall through with Figma's original bytes rather than dropping the page.
    }

    try {
      const embedded = await doc.embedJpg(bytes)
      // Figma exports at 1px = 1pt, so dividing by the scale restores the page to the
      // size it would have had as a vector export.
      const width = page.width
      const height = page.height
      const pdfPage = doc.addPage([width, height])
      pdfPage.drawImage(embedded, { x: 0, y: 0, width, height })
      titles.push(page.name)
    } catch {
      continue
    }
  }

  if (doc.getPageCount() === 0) return null

  if (input.bookmarks && titles.length > 1) addOutline(doc, titles)
  doc.setProducer('Quire')
  doc.setCreator('Quire for Figma (flattened)')

  return doc.save({ useObjectStreams: true })
}

/**
 * Export scale for a target DPI.
 *
 * Figma exports 1 px per point at scale 1, so the scale factor is simply the ratio of
 * target DPI to PDF's native 72 DPI. Capped at 4 because beyond that the export is
 * enormous and Figma starts refusing very large rasters outright.
 */
export function scaleForDpi(dpi: number): number {
  return Math.max(0.25, Math.min(4, dpi / 72))
}
