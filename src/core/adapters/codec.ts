/**
 * The one thing `core/` cannot do purely.
 *
 * Decoding and re-encoding pixels needs either a canvas (browser) or a native/JS
 * codec (Node). Rather than let that dependency leak into the image pipeline, the
 * pipeline takes this interface and the two realms supply their own implementation.
 * That is what makes `core/images` testable outside Figma.
 */

/** Straight RGBA8, four bytes per pixel, row-major, no padding. */
export interface RawImage {
  width: number
  height: number
  /** length === width * height * 4 */
  data: Uint8Array
}

export interface ImageCodec {
  decodeJpeg(bytes: Uint8Array): Promise<RawImage>
  /** `quality` is 0–1. Alpha is discarded; JPEG has no alpha channel. */
  encodeJpeg(image: RawImage, quality: number): Promise<Uint8Array>
  /**
   * Resample to exact dimensions. Implementations should use a smoothing filter —
   * nearest-neighbour downsampling of a screenshot looks visibly broken.
   */
  resize(image: RawImage, width: number, height: number): Promise<RawImage>
}

/**
 * Expand packed PDF image samples into RGBA.
 *
 * PDF stores image data as tightly packed components in whatever colour space the
 * image declares. Only 8-bit gray, RGB and CMYK are handled; anything else returns
 * null so the caller leaves that image untouched rather than corrupting it.
 */
export function samplesToRgba(
  samples: Uint8Array,
  width: number,
  height: number,
  components: number,
  bitsPerComponent: number,
): RawImage | null {
  if (bitsPerComponent !== 8) return null
  const pixels = width * height
  if (samples.length < pixels * components) return null

  const data = new Uint8Array(pixels * 4)

  if (components === 1) {
    for (let i = 0; i < pixels; i++) {
      const v = samples[i]
      data[i * 4] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
    return { width, height, data }
  }

  if (components === 3) {
    for (let i = 0; i < pixels; i++) {
      data[i * 4] = samples[i * 3]
      data[i * 4 + 1] = samples[i * 3 + 1]
      data[i * 4 + 2] = samples[i * 3 + 2]
      data[i * 4 + 3] = 255
    }
    return { width, height, data }
  }

  if (components === 4) {
    // DeviceCMYK, additive-inverted the way PDF stores it.
    for (let i = 0; i < pixels; i++) {
      const c = samples[i * 4] / 255
      const m = samples[i * 4 + 1] / 255
      const y = samples[i * 4 + 2] / 255
      const k = samples[i * 4 + 3] / 255
      data[i * 4] = Math.round(255 * (1 - Math.min(1, c + k)))
      data[i * 4 + 1] = Math.round(255 * (1 - Math.min(1, m + k)))
      data[i * 4 + 2] = Math.round(255 * (1 - Math.min(1, y + k)))
      data[i * 4 + 3] = 255
    }
    return { width, height, data }
  }

  return null
}

/** Flatten RGBA back to packed RGB, for re-encoding as a DeviceRGB Flate stream. */
export function rgbaToRgb(image: RawImage): Uint8Array {
  const pixels = image.width * image.height
  const out = new Uint8Array(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    out[i * 3] = image.data[i * 4]
    out[i * 3 + 1] = image.data[i * 4 + 1]
    out[i * 3 + 2] = image.data[i * 4 + 2]
  }
  return out
}

/** Extract the alpha channel as an 8-bit gray plane, for rebuilding an /SMask. */
export function rgbaToAlpha(image: RawImage): Uint8Array {
  const pixels = image.width * image.height
  const out = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) out[i] = image.data[i * 4 + 3]
  return out
}

/** Expand an 8-bit gray plane into RGBA, so a mask can go through `resize`. */
export function grayToRgba(gray: Uint8Array, width: number, height: number): RawImage {
  const pixels = width * height
  const data = new Uint8Array(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    const v = gray[i] ?? 0
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}
