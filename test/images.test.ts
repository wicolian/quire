import { unzlibSync } from 'fflate'
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { nodeCodec } from '../src/core/adapters/codec.node'
import { countImages, recompressImages } from '../src/core/images'
import { mergePdfs } from '../src/core/merge'
import { imagePage, vectorPage } from './fixtures/build'

/** Pull every image XObject out of a document so tests can assert on them directly. */
function images(doc: PDFDocument): { ref: PDFRef; stream: PDFRawStream }[] {
  const found: { ref: PDFRef; stream: PDFRawStream }[] = []
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const subtype = obj.dict.get(PDFName.of('Subtype'))
      if (subtype instanceof PDFName && subtype.asString() === '/Image') found.push({ ref, stream: obj })
    }
  }
  return found
}

function dictNumber(stream: PDFRawStream, key: string): number | undefined {
  const value = stream.dict.get(PDFName.of(key))
  return value && 'asNumber' in value ? (value as { asNumber(): number }).asNumber() : undefined
}

const baseOptions = {
  dpi: 150,
  quality: 0.8,
  skipSmallImages: true,
  fallbackWidthPt: 1240,
  codec: nodeCodec,
}

describe('recompressImages', () => {
  it('downsamples an image drawn far smaller than its pixel size', async () => {
    // 3000px placed at 300pt is 720 DPI. At a 150 DPI target it should land near 625px.
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 3000,
        imageHeight: 3000,
        drawWidth: 300,
        drawHeight: 300,
        encoding: 'jpeg',
      }),
    ])

    const before = images(doc)[0].stream.contents.length
    const result = await recompressImages(doc, baseOptions)

    expect(result.recompressed).toBe(1)
    expect(result.bytesSaved).toBeGreaterThan(0)

    const after = images(doc)[0]
    expect(dictNumber(after.stream, 'Width')).toBeLessThan(1000)
    expect(after.stream.contents.length).toBeLessThan(before)
  })

  it('leaves an image alone when it is already at the target resolution', async () => {
    // 600px drawn at 300pt is exactly 144 DPI, under the 150 DPI target.
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 600,
        imageHeight: 600,
        drawWidth: 300,
        drawHeight: 300,
        encoding: 'jpeg',
      }),
    ])

    const before = images(doc)[0].stream.contents.length
    const result = await recompressImages(doc, baseOptions)

    expect(result.recompressed).toBe(0)
    expect(result.skipped).toBe(1)
    expect(images(doc)[0].stream.contents.length).toBe(before)
  })

  it('converts a Flate image to JPEG when that is smaller', async () => {
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 1200,
        imageHeight: 1200,
        drawWidth: 300,
        drawHeight: 300,
        encoding: 'flate',
      }),
    ])

    const result = await recompressImages(doc, baseOptions)
    expect(result.recompressed).toBe(1)

    const after = images(doc)[0].stream
    expect((after.dict.get(PDFName.of('Filter')) as PDFName).asString()).toBe('/DCTDecode')
    expect((after.dict.get(PDFName.of('ColorSpace')) as PDFName).asString()).toBe('/DeviceRGB')
  })

  it('keeps transparency working by shrinking the soft mask with its parent', async () => {
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 1600,
        imageHeight: 1600,
        drawWidth: 200,
        drawHeight: 200,
        encoding: 'flate',
        withSoftMask: true,
      }),
    ])

    expect(countImages(doc)).toBe(2) // the image and its mask

    await recompressImages(doc, baseOptions)

    const parent = images(doc).find((entry) => entry.stream.dict.get(PDFName.of('SMask')))
    expect(parent).toBeDefined()

    const maskRef = parent!.stream.dict.get(PDFName.of('SMask')) as PDFRef
    const mask = doc.context.lookup(maskRef) as PDFRawStream

    // The mask must still exist, still be grayscale, and match the parent's new size.
    expect(mask).toBeInstanceOf(PDFRawStream)
    expect((mask.dict.get(PDFName.of('ColorSpace')) as PDFName).asString()).toBe('/DeviceGray')
    expect(dictNumber(mask, 'Width')).toBe(dictNumber(parent!.stream, 'Width'))
    expect(dictNumber(mask, 'Height')).toBe(dictNumber(parent!.stream, 'Height'))
  })

  it('preserves the gradient in a soft mask instead of flattening it opaque', async () => {
    // The defect this covers: a DeviceGray soft mask decodes with its gray value in
    // R, G and B and alpha hardcoded to 255. Reading the alpha channel back out
    // returns a uniformly opaque mask, so every drop shadow renders as a hard block
    // and the constant buffer deflates to almost nothing.
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 1600,
        imageHeight: 1600,
        drawWidth: 200,
        drawHeight: 200,
        encoding: 'flate',
        withSoftMask: true,
      }),
    ])

    await recompressImages(doc, baseOptions)

    const parent = images(doc).find((entry) => entry.stream.dict.get(PDFName.of('SMask')))
    expect(parent).toBeDefined()

    const maskRef = parent!.stream.dict.get(PDFName.of('SMask')) as PDFRef
    const mask = doc.context.lookup(maskRef) as PDFRawStream
    const samples = unzlibSync(mask.contents)

    let min = 255
    let max = 0
    for (const value of samples) {
      if (value < min) min = value
      if (value > max) max = value
    }

    // The fixture mask is a horizontal ramp from 0 to 255. Downsampling should keep a
    // wide range; a collapsed mask has min === max.
    expect(max - min).toBeGreaterThan(200)
    expect(min).toBeLessThan(40)
    expect(max).toBeGreaterThan(215)
  })

  it('leaves a soft mask alone rather than replacing it with a constant', async () => {
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 900,
        imageHeight: 900,
        drawWidth: 150,
        drawHeight: 150,
        encoding: 'flate',
        withSoftMask: true,
      }),
    ])

    await recompressImages(doc, baseOptions)

    const parent = images(doc).find((entry) => entry.stream.dict.get(PDFName.of('SMask')))
    const maskRef = parent!.stream.dict.get(PDFName.of('SMask')) as PDFRef
    const mask = doc.context.lookup(maskRef) as PDFRawStream

    // A mask that deflates to near nothing is the signature of a constant buffer.
    expect(mask.contents.length).toBeGreaterThan(64)
  })

  it('never grows a stream it cannot improve', async () => {
    // An already-tiny JPEG: re-encoding could only add bytes and generational loss.
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 16,
        imageHeight: 16,
        drawWidth: 1200,
        drawHeight: 1200,
        encoding: 'jpeg',
      }),
    ])

    const before = images(doc)[0].stream.contents.length
    await recompressImages(doc, baseOptions)
    expect(images(doc)[0].stream.contents.length).toBeLessThanOrEqual(before)
  })

  it('does nothing to a vector-only document', async () => {
    // This is the reference document's shape: no images at all.
    const { doc } = await mergePdfs([await vectorPage('Cover'), await vectorPage('Introduction')])
    expect(countImages(doc)).toBe(0)

    const result = await recompressImages(doc, baseOptions)
    expect(result).toEqual({ recompressed: 0, skipped: 0, bytesSaved: 0 })
  })

  it('leaves a document loadable afterwards', async () => {
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 2000,
        imageHeight: 1400,
        drawWidth: 600,
        drawHeight: 420,
        encoding: 'jpeg',
      }),
      await imagePage({
        imageWidth: 1800,
        imageHeight: 1800,
        drawWidth: 300,
        drawHeight: 300,
        encoding: 'flate',
        withSoftMask: true,
      }),
    ])

    await recompressImages(doc, baseOptions)

    // The single most important assertion in this file: still a valid PDF.
    const reloaded = await PDFDocument.load(await doc.save({ useObjectStreams: true }))
    expect(reloaded.getPageCount()).toBe(2)
  })

  it('honours a lower DPI target with a smaller result', async () => {
    async function sizeAtDpi(dpi: number): Promise<number> {
      const { doc } = await mergePdfs([
        await imagePage({
          imageWidth: 2400,
          imageHeight: 2400,
          drawWidth: 600,
          drawHeight: 600,
          encoding: 'jpeg',
        }),
      ])
      await recompressImages(doc, { ...baseOptions, dpi })
      return images(doc)[0].stream.contents.length
    }

    expect(await sizeAtDpi(96)).toBeLessThan(await sizeAtDpi(200))
  })
})
