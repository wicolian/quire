import type { PDFDocument } from 'pdf-lib'
import type { ImageCodec } from './adapters/codec'
import { addOutline } from './bookmarks'
import { MAX_PASSES, nextPass } from './budget'
import { countImages, recompressImages } from './images'
import { dedupeStreams, mergePdfs } from './merge'
import { outputFilenames } from './naming'
import { groupByBreaks } from './ordering'
import type { CompressionParams, ExportReport, OutputFile, PageRef } from './types'

/**
 * The whole export, start to finish.
 *
 * Takes already-exported per-frame PDF bytes and produces finished files. Deliberately
 * knows nothing about Figma or the DOM: it is handed bytes and a codec, and hands back
 * bytes. That is what lets the entire risky part of this plugin be tested in Node.
 */

export interface PipelineInput {
  docName: string
  /** Pages in final export order, excluded ones already removed. */
  pages: PageRef[]
  /** Page id → its exported single-page PDF. Missing ids are reported as failures. */
  pdfBytes: Map<string, Uint8Array>
  /** Page ids that start a new output file. */
  breaks: string[]
  mode: 'combined' | 'split'
  bookmarks: boolean
  params: CompressionParams
  codec: ImageCodec
  onProgress?: (stage: string, done: number, total: number) => void
  /** Checked between pages so a long export can be abandoned. */
  shouldCancel?: () => boolean
}

export class CancelledError extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'CancelledError'
  }
}

/** Width of the first page, used as the fallback when an image's placement is unknown. */
function firstPageWidthPt(doc: PDFDocument): number {
  const pages = doc.getPages()
  // A4 in points, as a last resort. Every Figma page export has a size, so this is
  // only reached for a document with no pages at all.
  if (pages.length === 0) return 595
  return pages[0].getWidth()
}

/**
 * Build one output file from one group of pages, compressing until it fits.
 *
 * The compression loop is bounded: after `MAX_PASSES` attempts, or once neither
 * quality nor resolution can move any further, it stops and reports being over rather
 * than degrading the document indefinitely. Being told "9.1 MB, still over 8 MB" is
 * more useful than silently receiving something unusable.
 */
async function buildFile(
  filename: string,
  group: PageRef[],
  input: PipelineInput,
  report: ExportReport,
): Promise<OutputFile | null> {
  const sources: Uint8Array[] = []
  const titles: string[] = []

  for (const page of group) {
    const bytes = input.pdfBytes.get(page.id)
    if (!bytes) {
      report.failedPages.push({ id: page.id, name: page.name, reason: 'Frame could not be exported' })
      continue
    }
    sources.push(bytes)
    titles.push(page.name)
  }

  if (sources.length === 0) return null

  let params = input.params
  let best: { bytes: Uint8Array; pageCount: number } | null = null

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (input.shouldCancel?.()) throw new CancelledError()

    const merged = await mergePdfs(sources)
    for (const failure of merged.failed) {
      const page = group[failure.index]
      if (page) {
        report.failedPages.push({ id: page.id, name: page.name, reason: failure.reason })
      }
    }

    const doc = merged.doc
    if (doc.getPageCount() === 0) return null

    // Dedupe first: it is lossless and it shrinks the set of images the lossy pass
    // then has to work on.
    report.bytesSavedByDedupe += dedupeStreams(doc)

    if (countImages(doc) > 0) {
      const imageResult = await recompressImages(doc, {
        dpi: params.dpi,
        quality: params.quality,
        skipSmallImages: params.skipSmallImages,
        fallbackWidthPt: firstPageWidthPt(doc),
        codec: input.codec,
        onProgress: (done, total) => input.onProgress?.('images', done, total),
      })
      report.imagesRecompressed += imageResult.recompressed
      report.bytesSavedByImages += imageResult.bytesSaved
      // Deduping again catches images that became identical after being resampled to
      // the same target size.
      report.bytesSavedByDedupe += dedupeStreams(doc, 1)
    }

    if (input.bookmarks && titles.length > 1) addOutline(doc, titles)

    doc.setProducer('Quire')
    doc.setCreator('Quire for Figma')

    const bytes = await doc.save({ useObjectStreams: true })
    const pageCount = doc.getPageCount()

    if (!best || bytes.length < best.bytes.length) best = { bytes, pageCount }

    if (params.capBytes === null || bytes.length <= params.capBytes) {
      return { filename, bytes: best.bytes, pageCount: best.pageCount }
    }

    const retry = nextPass(params, bytes.length, params.capBytes)
    if (!retry) break
    params = retry
  }

  if (!best) return null

  if (params.capBytes !== null && best.bytes.length > params.capBytes) {
    report.overCap.push({ filename, bytes: best.bytes.length, capBytes: params.capBytes })
  }

  return { filename, bytes: best.bytes, pageCount: best.pageCount }
}

export async function runPipeline(input: PipelineInput): Promise<ExportReport> {
  const report: ExportReport = {
    files: [],
    failedPages: [],
    overCap: [],
    imagesRecompressed: 0,
    bytesSavedByDedupe: 0,
    bytesSavedByImages: 0,
  }

  if (input.pages.length === 0) return report

  // Split mode ignores break markers, every page is its own file already.
  const groups =
    input.mode === 'split'
      ? input.pages.map((page) => [page])
      : groupByBreaks(input.pages, input.breaks)

  const filenames = outputFilenames(input.docName, groups, input.mode)

  for (let i = 0; i < groups.length; i++) {
    if (input.shouldCancel?.()) throw new CancelledError()
    input.onProgress?.('assemble', i, groups.length)

    const file = await buildFile(filenames[i], groups[i], input, report)
    if (file) report.files.push(file)
  }

  input.onProgress?.('assemble', groups.length, groups.length)
  return report
}
