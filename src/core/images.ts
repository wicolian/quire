import { zlibSync } from 'fflate'
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFContext,
  type PDFDocument,
} from 'pdf-lib'
import { rgbaToGray, samplesToRgba, type ImageCodec, type RawImage } from './adapters/codec'
import { scanPlacements, type PlacementMap } from './placement'

/** A resize failure should cost the compression, not the image. */
async function resizeSafe(
  impl: ImageCodec,
  image: RawImage,
  width: number,
  height: number,
): Promise<RawImage> {
  try {
    return await impl.resize(image, width, height)
  } catch {
    return image
  }
}

/**
 * Recompressing the images embedded in a merged PDF.
 *
 * Everything here is guarded by one rule: an image is only replaced when the result
 * is both valid and genuinely smaller. Every case we cannot handle confidently -
 * exotic filters, indexed palettes, stencil masks, leaves the original untouched.
 * A slightly larger PDF is a far better outcome than a corrupted one.
 */

export interface ImagePassResult {
  recompressed: number
  skipped: number
  bytesSaved: number
}

const NAME = {
  Subtype: PDFName.of('Subtype'),
  Image: PDFName.of('Image'),
  Width: PDFName.of('Width'),
  Height: PDFName.of('Height'),
  Filter: PDFName.of('Filter'),
  ColorSpace: PDFName.of('ColorSpace'),
  BitsPerComponent: PDFName.of('BitsPerComponent'),
  SMask: PDFName.of('SMask'),
  Mask: PDFName.of('Mask'),
  ImageMask: PDFName.of('ImageMask'),
  DecodeParms: PDFName.of('DecodeParms'),
  Decode: PDFName.of('Decode'),
  DeviceRGB: PDFName.of('DeviceRGB'),
  DeviceGray: PDFName.of('DeviceGray'),
  DCTDecode: PDFName.of('DCTDecode'),
  FlateDecode: PDFName.of('FlateDecode'),
  N: PDFName.of('N'),
  Length: PDFName.of('Length'),
}

function nameOf(value: unknown): string | null {
  return value instanceof PDFName ? value.asString().replace(/^\//, '') : null
}

function numberOf(value: unknown): number | null {
  return value instanceof PDFNumber ? value.asNumber() : null
}

/** The filter chain, flattened. A single filter may be a name or a one-element array. */
function filterNames(dict: PDFDict): string[] {
  const filter = dict.get(NAME.Filter)
  if (filter instanceof PDFName) {
    const name = nameOf(filter)
    return name ? [name] : []
  }
  if (filter instanceof PDFArray) {
    const names: string[] = []
    for (let i = 0; i < filter.size(); i++) {
      const name = nameOf(filter.get(i))
      if (name) names.push(name)
    }
    return names
  }
  return []
}

/**
 * Components per pixel for a colour space.
 *
 * Returns null for anything requiring a palette or tint transform to interpret -
 * those are left alone rather than guessed at.
 */
function colorSpaceComponents(context: PDFContext, value: unknown): number | null {
  const resolved = value instanceof PDFRef ? context.lookup(value) : value

  const direct = nameOf(resolved)
  if (direct) {
    if (direct === 'DeviceGray' || direct === 'CalGray' || direct === 'G') return 1
    if (direct === 'DeviceRGB' || direct === 'CalRGB' || direct === 'RGB') return 3
    if (direct === 'DeviceCMYK' || direct === 'CMYK') return 4
    return null
  }

  if (resolved instanceof PDFArray && resolved.size() > 0) {
    const family = nameOf(resolved.get(0))
    if (family === 'ICCBased') {
      const streamRef = resolved.get(1)
      const stream = streamRef instanceof PDFRef ? context.lookup(streamRef) : streamRef
      if (stream instanceof PDFRawStream) {
        const n = numberOf(stream.dict.get(NAME.N))
        if (n === 1 || n === 3 || n === 4) return n
      }
      return null
    }
    if (family === 'CalGray') return 1
    if (family === 'CalRGB' || family === 'Lab') return 3
    // Indexed, Separation, DeviceN and pattern spaces need a transform we do not model.
    return null
  }

  return null
}

/** Decode an image XObject to RGBA, or null when we cannot do it safely. */
async function decodeImage(
  context: PDFContext,
  stream: PDFRawStream,
  codec: ImageCodec,
): Promise<RawImage | null> {
  const dict = stream.dict
  const width = numberOf(dict.get(NAME.Width))
  const height = numberOf(dict.get(NAME.Height))
  if (!width || !height || width < 1 || height < 1) return null

  const filters = filterNames(dict)

  if (filters.includes('DCTDecode')) {
    // Only a bare JPEG is safe to hand to the decoder; a JPEG wrapped in another
    // filter would need unwrapping first.
    if (filters.length !== 1) return null
    try {
      return await codec.decodeJpeg(stream.contents)
    } catch {
      return null
    }
  }

  if (filters.length === 0 || filters.every((f) => f === 'FlateDecode' || f === 'LZWDecode')) {
    const bits = numberOf(dict.get(NAME.BitsPerComponent)) ?? 8
    if (bits !== 8) return null
    const components = colorSpaceComponents(context, dict.get(NAME.ColorSpace))
    if (!components) return null
    try {
      const samples = decodePDFRawStream(stream).decode()
      return samplesToRgba(samples, width, height, components, bits)
    } catch {
      return null
    }
  }

  // JPX, CCITTFax, JBIG2 and friends: leave them exactly as they are.
  return null
}

/** Target pixel dimensions for an image, given how large it is drawn and a DPI goal. */
function targetSize(
  current: { width: number; height: number },
  placement: { widthPt: number; heightPt: number } | undefined,
  fallbackWidthPt: number,
  dpi: number,
): { width: number; height: number } {
  // No placement means the scanner could not locate this image. Assuming it spans the
  // full page width under-estimates its DPI and therefore under-compresses it, which
  // is the right direction to fail in.
  const widthPt = placement?.widthPt || fallbackWidthPt
  const heightPt =
    placement?.heightPt || (fallbackWidthPt * current.height) / Math.max(1, current.width)

  const width = Math.max(1, Math.round((widthPt / 72) * dpi))
  const height = Math.max(1, Math.round((heightPt / 72) * dpi))

  // Never upscale, that would add bytes and invent detail.
  return {
    width: Math.min(current.width, width),
    height: Math.min(current.height, height),
  }
}

/** Replace an image XObject's bytes and the dictionary entries that describe them. */
function assignImage(
  context: PDFContext,
  ref: PDFRef,
  original: PDFRawStream,
  bytes: Uint8Array,
  width: number,
  height: number,
  encoding: 'jpeg' | 'flate-gray',
): void {
  const dict = original.dict.clone(context)
  dict.set(NAME.Width, PDFNumber.of(width))
  dict.set(NAME.Height, PDFNumber.of(height))
  dict.set(NAME.BitsPerComponent, PDFNumber.of(8))
  dict.set(NAME.Filter, encoding === 'jpeg' ? NAME.DCTDecode : NAME.FlateDecode)
  dict.set(NAME.ColorSpace, encoding === 'jpeg' ? NAME.DeviceRGB : NAME.DeviceGray)
  // These describe the *old* bytes; leaving them behind would misdecode the new ones.
  dict.delete(NAME.DecodeParms)
  dict.delete(NAME.Decode)
  dict.set(NAME.Length, PDFNumber.of(bytes.length))

  context.assign(ref, PDFRawStream.of(dict, bytes))
}

/** Range of values in a plane. Zero means every pixel is identical. */
function spread(plane: Uint8Array): number {
  let min = 255
  let max = 0
  for (const value of plane) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return max - min
}

/**
 * Downsample a soft mask alongside its parent image.
 *
 * The mask is a separate grayscale image whose pixel grid does not have to match the
 * parent's, but leaving a 4000px mask attached to a 1200px image wastes most of what
 * the parent just saved.
 */
async function shrinkSoftMask(
  context: PDFContext,
  parentDict: PDFDict,
  target: { width: number; height: number },
  codec: ImageCodec,
): Promise<number> {
  const maskRef = parentDict.get(NAME.SMask)
  if (!(maskRef instanceof PDFRef)) return 0
  const mask = context.lookup(maskRef)
  if (!(mask instanceof PDFRawStream)) return 0

  const maskWidth = numberOf(mask.dict.get(NAME.Width))
  const maskHeight = numberOf(mask.dict.get(NAME.Height))
  if (!maskWidth || !maskHeight) return 0
  if (maskWidth <= target.width && maskHeight <= target.height) return 0

  const decoded = await decodeImage(context, mask, codec)
  if (!decoded) return 0

  const resized = await codec.resize(decoded, target.width, target.height)
  const gray = rgbaToGray(resized)

  // A soft mask that has lost all variation is the failure this whole path is prone
  // to, and it is invisible to a size check: a constant buffer always deflates
  // smaller, so it always wins on bytes while destroying the effect it encodes.
  // Compare against the source and refuse the swap if the gradient did not survive.
  const before = spread(rgbaToGray(decoded))
  const after = spread(gray)
  if (before > 8 && after < before / 4) return 0

  const deflated = zlibSync(gray, { level: 9 })
  if (deflated.length >= mask.contents.length) return 0

  const saved = mask.contents.length - deflated.length
  assignImage(context, maskRef, mask, deflated, target.width, target.height, 'flate-gray')
  return saved
}

export interface ImagePassOptions {
  dpi: number
  quality: number
  skipSmallImages: boolean
  /** Page width in points, used when an image's placement cannot be determined. */
  fallbackWidthPt: number
  codec: ImageCodec
  /** Called between images so a long export can yield to the UI thread. */
  onProgress?: (done: number, total: number) => void
}

/**
 * Walk every image XObject in the document, downsample and re-encode where it helps.
 *
 * Mutates `doc` in place and reports what it did. Safe to call on a document with no
 * images at all, which is exactly what a vector-only Figma document looks like.
 */
export async function recompressImages(
  doc: PDFDocument,
  options: ImagePassOptions,
): Promise<ImagePassResult> {
  const context = doc.context
  const placements: PlacementMap = scanPlacements(doc)

  const targets: { ref: PDFRef; stream: PDFRawStream }[] = []
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    if (nameOf(obj.dict.get(NAME.Subtype)) !== 'Image') continue

    // 1-bit stencil masks are tiny and re-encoding one as RGB would both grow the
    // file and break the drawing operation that references it.
    const isStencil = obj.dict.get(NAME.ImageMask)
    if (isStencil instanceof PDFBool && isStencil.asBoolean()) continue

    targets.push({ ref, stream: obj })
  }

  const result: ImagePassResult = { recompressed: 0, skipped: 0, bytesSaved: 0 }
  const softMasks = new Set<string>()
  for (const { stream } of targets) {
    const smask = stream.dict.get(NAME.SMask)
    if (smask instanceof PDFRef) softMasks.add(smask.tag)
  }

  let done = 0
  for (const { ref, stream } of targets) {
    done++
    options.onProgress?.(done, targets.length)

    // Soft masks are handled with their parent, where the correct target size is
    // known. Processing one standalone would size it against a placement it does
    // not have.
    if (softMasks.has(ref.tag)) continue

    const width = numberOf(stream.dict.get(NAME.Width))
    const height = numberOf(stream.dict.get(NAME.Height))
    if (!width || !height) {
      result.skipped++
      continue
    }

    const target = targetSize(
      { width, height },
      placements.get(ref.tag),
      options.fallbackWidthPt,
      options.dpi,
    )

    const alreadySmall = target.width >= width && target.height >= height
    if (options.skipSmallImages && alreadySmall && filterNames(stream.dict).includes('DCTDecode')) {
      // Already at or below target resolution and already JPEG: re-encoding could
      // only add generational loss for no size win.
      result.skipped++
      continue
    }

    const decoded = await decodeImage(context, stream, options.codec)
    if (!decoded) {
      result.skipped++
      continue
    }

    const resized =
      target.width === decoded.width && target.height === decoded.height
        ? decoded
        : await resizeSafe(options.codec, decoded, target.width, target.height)

    let encoded: Uint8Array
    try {
      encoded = await options.codec.encodeJpeg(resized, options.quality)
    } catch {
      result.skipped++
      continue
    }

    // The decisive guard: only accept the new bytes if they are actually smaller.
    if (encoded.length >= stream.contents.length) {
      result.skipped++
      continue
    }

    result.bytesSaved += stream.contents.length - encoded.length
    result.recompressed++

    const parentDict = stream.dict
    assignImage(context, ref, stream, encoded, resized.width, resized.height, 'jpeg')
    result.bytesSaved += await shrinkSoftMask(context, parentDict, target, options.codec)
  }

  return result
}

/** Exported for tests: how many image XObjects a document contains. */
export function countImages(doc: PDFDocument): number {
  let count = 0
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && nameOf(obj.dict.get(NAME.Subtype)) === 'Image') count++
  }
  return count
}
