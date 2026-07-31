import jpeg from 'jpeg-js'
import { zlibSync } from 'fflate'
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib'

/**
 * Synthetic single-page PDFs that stand in for Figma's per-frame export.
 *
 * These are built rather than committed as binaries so the inputs to every test are
 * visible and adjustable. They mimic the structures Figma actually emits, a vector
 * page, a DCTDecode photo, a Flate image with a soft mask, the same logo repeated
 * across pages, which is what the pipeline has to survive.
 *
 * They are not a substitute for testing against a genuine Figma export. See
 * `test/README.md` for how to drop a real one in.
 */

/** A4 at 150 DPI, matching the reference document's 1240x1754 frames. */
export const A4_150 = { width: 1240, height: 1754 }

/** A recognisable gradient, so a resized version is visibly derived from the original. */
export function gradientJpeg(width: number, height: number, quality = 92): Uint8Array {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = Math.round((x / Math.max(1, width - 1)) * 255)
      data[i + 1] = Math.round((y / Math.max(1, height - 1)) * 255)
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }
  return new Uint8Array(jpeg.encode({ data, width, height }, quality).data)
}

/** Packed RGB samples for a Flate-encoded image. */
export function gradientRgb(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      out[i] = Math.round((x / Math.max(1, width - 1)) * 255)
      out[i + 1] = 64
      out[i + 2] = Math.round((y / Math.max(1, height - 1)) * 255)
    }
  }
  return out
}

/** An 8-bit alpha plane: a soft horizontal ramp. */
export function alphaRamp(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = Math.round((x / Math.max(1, width - 1)) * 255)
    }
  }
  return out
}

/** A page of text and vector shapes, what a Figma document page mostly is. */
export async function vectorPage(title: string, size = A4_150): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([size.width, size.height])
  const font = await doc.embedFont(StandardFonts.Helvetica)

  page.drawText(title, { x: 100, y: size.height - 160, size: 42, font })
  page.drawText("A buyer's comparison", { x: 100, y: size.height - 220, size: 18, font })
  page.drawRectangle({ x: 100, y: size.height - 260, width: 72, height: 4 })

  for (let i = 0; i < 24; i++) {
    page.drawText(`Row ${i + 1}, supporting body copy for the page.`, {
      x: 100,
      y: size.height - 340 - i * 34,
      size: 13,
      font,
    })
  }

  return doc.save()
}

export interface ImagePageOptions {
  /** Pixel dimensions of the embedded image. */
  imageWidth: number
  imageHeight: number
  /** How large it is drawn on the page, in points. Drives effective DPI. */
  drawWidth: number
  drawHeight: number
  encoding: 'jpeg' | 'flate'
  withSoftMask?: boolean
  size?: { width: number; height: number }
  /** Reuse identical bytes across pages, to exercise dedupe. */
  jpegBytes?: Uint8Array
}

/**
 * A page containing exactly one image, placed with an explicit CTM.
 *
 * Built at the object level rather than via `drawImage` so the encoding, colour space
 * and soft mask are all exactly what the test intends.
 */
export async function imagePage(options: ImagePageOptions): Promise<Uint8Array> {
  const size = options.size ?? A4_150
  const doc = await PDFDocument.create()
  const page = doc.addPage([size.width, size.height])
  const context = doc.context

  const dict = new Map<PDFName, unknown>()
  let contents: Uint8Array

  if (options.encoding === 'jpeg') {
    contents = options.jpegBytes ?? gradientJpeg(options.imageWidth, options.imageHeight)
    dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
    dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'))
  } else {
    contents = zlibSync(gradientRgb(options.imageWidth, options.imageHeight), { level: 6 })
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
    dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'))
  }

  const imageDict = PDFDict.withContext(context)
  imageDict.set(PDFName.of('Type'), PDFName.of('XObject'))
  imageDict.set(PDFName.of('Subtype'), PDFName.of('Image'))
  imageDict.set(PDFName.of('Width'), PDFNumber.of(options.imageWidth))
  imageDict.set(PDFName.of('Height'), PDFNumber.of(options.imageHeight))
  imageDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
  for (const [key, value] of dict) imageDict.set(key, value as never)

  if (options.withSoftMask) {
    const maskDict = PDFDict.withContext(context)
    maskDict.set(PDFName.of('Type'), PDFName.of('XObject'))
    maskDict.set(PDFName.of('Subtype'), PDFName.of('Image'))
    maskDict.set(PDFName.of('Width'), PDFNumber.of(options.imageWidth))
    maskDict.set(PDFName.of('Height'), PDFNumber.of(options.imageHeight))
    maskDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
    maskDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'))
    maskDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))

    const maskBytes = zlibSync(alphaRamp(options.imageWidth, options.imageHeight), { level: 6 })
    const maskRef = context.register(PDFRawStream.of(maskDict, maskBytes))
    imageDict.set(PDFName.of('SMask'), maskRef)
  }

  const imageRef = context.register(PDFRawStream.of(imageDict, contents))
  page.node.setXObject(PDFName.of('Im0'), imageRef)

  // The CTM is what the placement scanner reads to work out effective DPI.
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(options.drawWidth, 0, 0, options.drawHeight, 40, 40),
    drawObject('Im0'),
    popGraphicsState(),
  )

  return doc.save()
}

/** A document's worth of pages, each carrying the same logo. Exercises dedupe. */
export async function pagesSharingLogo(count: number, logoPx = 400): Promise<Uint8Array[]> {
  const logo = gradientJpeg(logoPx, logoPx)
  const pages: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    pages.push(
      await imagePage({
        imageWidth: logoPx,
        imageHeight: logoPx,
        drawWidth: 120,
        drawHeight: 120,
        encoding: 'jpeg',
        jpegBytes: logo,
      }),
    )
  }
  return pages
}
