import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { nodeCodec } from '../src/core/adapters/codec.node'
import { countImages } from '../src/core/images'
import { runPipeline } from '../src/core/pipeline'
import type { PageRef } from '../src/core/types'

/**
 * Validation against genuine Figma output.
 *
 * Everything else in this suite runs on fixtures this repo builds itself. Those prove
 * the logic, but they cannot prove Quire survives the specific structures Figma emits
 * — its font subsetting, its colour spaces, its content stream style.
 *
 * To run these: export some frames from Figma as PDF (one file per frame) and drop
 * them into `test/fixtures/real/`. That directory is gitignored, so nobody's marketing
 * documents end up in a public repo. Without it, these tests skip.
 */

const REAL_DIR = join(__dirname, 'fixtures', 'real')

function realExports(): { name: string; bytes: Uint8Array }[] {
  if (!existsSync(REAL_DIR)) return []
  return readdirSync(REAL_DIR)
    .filter((file) => file.toLowerCase().endsWith('.pdf'))
    .sort()
    .map((file) => ({ name: file.replace(/\.pdf$/i, ''), bytes: new Uint8Array(readFileSync(join(REAL_DIR, file))) }))
}

const files = realExports()
const runIf = files.length > 0 ? describe : describe.skip

runIf('real Figma exports', () => {
  const pages: PageRef[] = files.map((file, index) => ({
    id: `p${index}`,
    name: file.name,
    x: index * 1400,
    y: 0,
    width: 1240,
    height: 1754,
  }))

  const pdfBytes = new Map(files.map((file, index) => [`p${index}`, file.bytes]))

  it('merges every page without losing any', async () => {
    const report = await runPipeline({
      docName: 'Real export',
      pages,
      pdfBytes,
      breaks: [],
      mode: 'combined',
      bookmarks: true,
      params: { dpi: 150, quality: 0.82, capBytes: null, skipSmallImages: true },
      codec: nodeCodec,
    })

    expect(report.failedPages).toEqual([])
    expect(report.files).toHaveLength(1)

    const loaded = await PDFDocument.load(report.files[0].bytes)
    expect(loaded.getPageCount()).toBe(files.length)
  })

  it('produces a smaller file than the sum of its parts', async () => {
    const rawTotal = files.reduce((sum, file) => sum + file.bytes.length, 0)

    const report = await runPipeline({
      docName: 'Real export',
      pages,
      pdfBytes,
      breaks: [],
      mode: 'combined',
      bookmarks: false,
      params: { dpi: 150, quality: 0.82, capBytes: null, skipSmallImages: true },
      codec: nodeCodec,
    })

    // Merging alone should beat concatenation: shared resources collapse and there is
    // one file structure instead of N.
    expect(report.files[0].bytes.length).toBeLessThan(rawTotal)
    console.log(
      `real export: ${files.length} pages, ${(rawTotal / 1024 / 1024).toFixed(2)} MB raw → ` +
        `${(report.files[0].bytes.length / 1024 / 1024).toFixed(2)} MB merged ` +
        `(dedupe saved ${(report.bytesSavedByDedupe / 1024).toFixed(0)} KB, ` +
        `images saved ${(report.bytesSavedByImages / 1024).toFixed(0)} KB, ` +
        `${report.imagesRecompressed} images recompressed)`,
    )
  })

  it('keeps the merged document loadable and countable', async () => {
    const report = await runPipeline({
      docName: 'Real export',
      pages,
      pdfBytes,
      breaks: [],
      mode: 'combined',
      bookmarks: true,
      params: { dpi: 120, quality: 0.7, capBytes: null, skipSmallImages: true },
      codec: nodeCodec,
    })

    const loaded = await PDFDocument.load(report.files[0].bytes)
    expect(loaded.getPageCount()).toBe(files.length)
    expect(countImages(loaded)).toBeGreaterThanOrEqual(0)
  })
})
