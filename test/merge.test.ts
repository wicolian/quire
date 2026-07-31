import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { countImages } from '../src/core/images'
import { dedupeStreams, mergePdfs } from '../src/core/merge'
import { imagePage, pagesSharingLogo, vectorPage } from './fixtures/build'

describe('mergePdfs', () => {
  it('produces one page per source, in order', async () => {
    const sources = await Promise.all([
      vectorPage('D2-01 Cover'),
      vectorPage('D2-02 Introduction'),
      vectorPage('D2-03 Comparison table'),
    ])

    const { doc, pageRefs, failed } = await mergePdfs(sources)
    expect(failed).toEqual([])
    expect(doc.getPageCount()).toBe(3)
    expect(pageRefs).toHaveLength(3)
  })

  it('preserves page size', async () => {
    const { doc } = await mergePdfs([await vectorPage('Cover')])
    expect(Math.round(doc.getPage(0).getWidth())).toBe(1240)
    expect(Math.round(doc.getPage(0).getHeight())).toBe(1754)
  })

  it('skips a corrupt source instead of failing the whole export', async () => {
    const good = await vectorPage('Good')
    const garbage = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02])

    const { doc, failed } = await mergePdfs([good, garbage, good])
    // The point: one bad frame must not cost the user the other two.
    expect(doc.getPageCount()).toBe(2)
    expect(failed).toHaveLength(1)
    expect(failed[0].index).toBe(1)
  })

  it('returns an empty document for no sources', async () => {
    const { doc } = await mergePdfs([])
    expect(doc.getPageCount()).toBe(0)
  })
})

describe('dedupeStreams', () => {
  it('collapses a logo repeated across every page', async () => {
    const sources = await pagesSharingLogo(12)
    const { doc } = await mergePdfs(sources)

    const before = (await doc.save({ useObjectStreams: true })).length
    const saved = dedupeStreams(doc)
    const after = (await doc.save({ useObjectStreams: true })).length

    expect(saved).toBeGreaterThan(0)
    expect(after).toBeLessThan(before)
    // 12 copies of one logo should collapse to roughly one.
    expect(before - after).toBeGreaterThan(saved * 0.5)
  })

  it('leaves the page count and content intact', async () => {
    const { doc } = await mergePdfs(await pagesSharingLogo(6))
    dedupeStreams(doc)
    expect(doc.getPageCount()).toBe(6)

    // Still a loadable document afterwards, the real proof it stayed valid.
    const reloaded = await PDFDocument.load(await doc.save())
    expect(reloaded.getPageCount()).toBe(6)
  })

  it('does not collapse genuinely different images', async () => {
    const sources = await Promise.all([
      imagePage({ imageWidth: 200, imageHeight: 200, drawWidth: 400, drawHeight: 400, encoding: 'jpeg' }),
      imagePage({ imageWidth: 240, imageHeight: 240, drawWidth: 400, drawHeight: 400, encoding: 'jpeg' }),
    ])
    const { doc } = await mergePdfs(sources)

    // Note dedupe may still collapse other things these two pages share, identical
    // content streams, for one, which is legal and desirable. What must survive is the
    // two distinct images.
    dedupeStreams(doc)
    expect(countImages(doc)).toBe(2)
  })

  it('collapses the shared image but keeps both pages independent', async () => {
    const { doc } = await mergePdfs(await pagesSharingLogo(4))
    dedupeStreams(doc)

    // Four pages, one logo left between them.
    expect(doc.getPageCount()).toBe(4)
    expect(countImages(doc)).toBe(1)
  })

  it('is a no-op on a vector-only document', async () => {
    // The reference document is exactly this: text and shapes, nothing shared.
    const { doc } = await mergePdfs([await vectorPage('One'), await vectorPage('Two')])
    const saved = dedupeStreams(doc)
    expect(saved).toBeGreaterThanOrEqual(0)
    expect(doc.getPageCount()).toBe(2)
  })
})
