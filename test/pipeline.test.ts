import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { nodeCodec } from '../src/core/adapters/codec.node'
import { CancelledError, runPipeline, type PipelineInput } from '../src/core/pipeline'
import type { PageRef } from '../src/core/types'
import { imagePage, vectorPage } from './fixtures/build'

const MB = 1024 * 1024

function page(id: string, name: string): PageRef {
  return { id, name, x: 0, y: 0, width: 1240, height: 1754 }
}

async function vectorDoc(names: string[]): Promise<{ pages: PageRef[]; bytes: Map<string, Uint8Array> }> {
  const pages = names.map((name, index) => page(`p${index}`, name))
  const bytes = new Map<string, Uint8Array>()
  for (const p of pages) bytes.set(p.id, await vectorPage(p.name))
  return { pages, bytes }
}

function baseInput(pages: PageRef[], bytes: Map<string, Uint8Array>): PipelineInput {
  return {
    docName: 'Doc 2 — Databrain and Lightdash',
    pages,
    pdfBytes: bytes,
    breaks: [],
    mode: 'combined',
    bookmarks: true,
    params: { dpi: 150, quality: 0.82, capBytes: null, skipSmallImages: true },
    codec: nodeCodec,
  }
}

describe('runPipeline', () => {
  it('assembles the reference document into one PDF', async () => {
    const { pages, bytes } = await vectorDoc([
      'D2-01 Cover',
      'D2-02 Introduction',
      'D2-03 Comparison table',
      'D2-04 Factor 1',
    ])

    const report = await runPipeline(baseInput(pages, bytes))

    expect(report.files).toHaveLength(1)
    expect(report.files[0].filename).toBe('Doc-2-Databrain-and-Lightdash.pdf')
    expect(report.files[0].pageCount).toBe(4)
    expect(report.failedPages).toEqual([])

    const loaded = await PDFDocument.load(report.files[0].bytes)
    expect(loaded.getPageCount()).toBe(4)
  })

  it('splits at break markers', async () => {
    const { pages, bytes } = await vectorDoc(['One', 'Two', 'Three', 'Four'])
    const report = await runPipeline({ ...baseInput(pages, bytes), breaks: ['p1', 'p3'] })

    expect(report.files).toHaveLength(3)
    expect(report.files.map((f) => f.pageCount)).toEqual([1, 2, 1])
  })

  it('emits one file per page in split mode', async () => {
    const { pages, bytes } = await vectorDoc(['Cover', 'Intro', 'Table'])
    const report = await runPipeline({ ...baseInput(pages, bytes), mode: 'split' })

    expect(report.files).toHaveLength(3)
    expect(report.files.map((f) => f.filename)).toEqual(['Cover.pdf', 'Intro.pdf', 'Table.pdf'])
  })

  it('ignores break markers in split mode', async () => {
    const { pages, bytes } = await vectorDoc(['One', 'Two'])
    const report = await runPipeline({ ...baseInput(pages, bytes), mode: 'split', breaks: ['p1'] })
    expect(report.files).toHaveLength(2)
  })

  it('adds an outline when asked', async () => {
    const { pages, bytes } = await vectorDoc(['D2-01 Cover', 'D2-02 Introduction'])

    const withOutline = await runPipeline(baseInput(pages, bytes))
    const without = await runPipeline({ ...baseInput(pages, bytes), bookmarks: false })

    const loaded = await PDFDocument.load(withOutline.files[0].bytes)
    expect(loaded.catalog.get(await import('pdf-lib').then((m) => m.PDFName.of('Outlines')))).toBeDefined()
    // The outline adds objects, so the file is larger than the same document without one.
    expect(withOutline.files[0].bytes.length).toBeGreaterThan(without.files[0].bytes.length)
  })

  it('reports a page whose export never arrived instead of dropping it silently', async () => {
    const { pages, bytes } = await vectorDoc(['One', 'Two', 'Three'])
    bytes.delete('p1')

    const report = await runPipeline(baseInput(pages, bytes))

    expect(report.files[0].pageCount).toBe(2)
    expect(report.failedPages).toHaveLength(1)
    expect(report.failedPages[0].name).toBe('Two')
  })

  it('records being over an impossible cap rather than degrading forever', async () => {
    const { pages, bytes } = await vectorDoc(['One', 'Two', 'Three'])

    const report = await runPipeline({
      ...baseInput(pages, bytes),
      // Unreachable for a real document: the pipeline must stop and say so.
      params: { dpi: 150, quality: 0.82, capBytes: 1024, skipSmallImages: true },
    })

    expect(report.files).toHaveLength(1)
    expect(report.overCap).toHaveLength(1)
    expect(report.overCap[0].bytes).toBeGreaterThan(1024)
  })

  it('reports no overCap when the document fits', async () => {
    const { pages, bytes } = await vectorDoc(['One'])
    const report = await runPipeline({
      ...baseInput(pages, bytes),
      params: { dpi: 150, quality: 0.82, capBytes: 10 * MB, skipSmallImages: true },
    })
    expect(report.overCap).toEqual([])
  })

  it('compresses images and reports the saving', async () => {
    const pages = [page('p0', 'Screenshot')]
    const bytes = new Map([
      [
        'p0',
        await imagePage({
          imageWidth: 2400,
          imageHeight: 1600,
          drawWidth: 400,
          drawHeight: 267,
          encoding: 'jpeg',
        }),
      ],
    ])

    const report = await runPipeline(baseInput(pages, bytes))
    expect(report.imagesRecompressed).toBe(1)
    expect(report.bytesSavedByImages).toBeGreaterThan(0)
  })

  it('returns an empty report for no pages', async () => {
    const report = await runPipeline(baseInput([], new Map()))
    expect(report.files).toEqual([])
  })

  it('aborts when cancelled', async () => {
    const { pages, bytes } = await vectorDoc(['One', 'Two'])
    await expect(
      runPipeline({ ...baseInput(pages, bytes), shouldCancel: () => true }),
    ).rejects.toBeInstanceOf(CancelledError)
  })
})
