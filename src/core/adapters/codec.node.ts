import jpeg from 'jpeg-js'
import type { ImageCodec, RawImage } from './codec'

/**
 * Node codec for tests. Pure JS on purpose, a native image dependency would make
 * `npm test` a build problem on someone else's machine, and the test suite is
 * checking the PDF pipeline's logic, not the fidelity of a resampler.
 *
 * Not used by the plugin at runtime.
 */

/**
 * Bilinear resample. Box-filtering would be better for large downscales, but this is
 * good enough to prove the pipeline moves the right pixels around.
 */
function bilinear(image: RawImage, width: number, height: number): RawImage {
  const out = new Uint8Array(width * height * 4)
  const xRatio = image.width / width
  const yRatio = image.height / height

  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, (y + 0.5) * yRatio - 0.5)
    const y0 = Math.max(0, Math.floor(sy))
    const y1 = Math.min(image.height - 1, y0 + 1)
    const wy = sy - y0

    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, (x + 0.5) * xRatio - 0.5)
      const x0 = Math.max(0, Math.floor(sx))
      const x1 = Math.min(image.width - 1, x0 + 1)
      const wx = sx - x0

      const i00 = (y0 * image.width + x0) * 4
      const i01 = (y0 * image.width + x1) * 4
      const i10 = (y1 * image.width + x0) * 4
      const i11 = (y1 * image.width + x1) * 4
      const target = (y * width + x) * 4

      for (let c = 0; c < 4; c++) {
        const top = image.data[i00 + c] * (1 - wx) + image.data[i01 + c] * wx
        const bottom = image.data[i10 + c] * (1 - wx) + image.data[i11 + c] * wx
        out[target + c] = Math.round(top * (1 - wy) + bottom * wy)
      }
    }
  }

  return { width, height, data: out }
}

export const nodeCodec: ImageCodec = {
  async decodeJpeg(bytes) {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
    return {
      width: decoded.width,
      height: decoded.height,
      data: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
    }
  },

  async encodeJpeg(image, quality) {
    // Match the browser codec: composite onto white so transparency does not become
    // black, since JPEG cannot carry alpha.
    const flattened = new Uint8Array(image.data.length)
    for (let i = 0; i < image.data.length; i += 4) {
      const alpha = image.data[i + 3] / 255
      flattened[i] = Math.round(image.data[i] * alpha + 255 * (1 - alpha))
      flattened[i + 1] = Math.round(image.data[i + 1] * alpha + 255 * (1 - alpha))
      flattened[i + 2] = Math.round(image.data[i + 2] * alpha + 255 * (1 - alpha))
      flattened[i + 3] = 255
    }
    const encoded = jpeg.encode(
      { data: Buffer.from(flattened), width: image.width, height: image.height },
      Math.round(quality * 100),
    )
    return new Uint8Array(encoded.data)
  },

  async resize(image, width, height) {
    if (width === image.width && height === image.height) return image
    return bilinear(image, width, height)
  },
}
