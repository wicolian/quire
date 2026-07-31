import type { ImageCodec, RawImage } from './codec'

/**
 * Browser codec, backed by OffscreenCanvas.
 *
 * Figma's plugin iframe is Chromium, so OffscreenCanvas and createImageBitmap are
 * both present. A DOM-canvas fallback is kept anyway: this code runs inside someone
 * else's application and being defensive about the environment costs almost nothing.
 */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function context2d(canvas: AnyCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = (canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas context unavailable')
  return ctx as CanvasRenderingContext2D
}

async function canvasToBytes(canvas: AnyCanvas, type: string, quality: number): Promise<Uint8Array> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type, quality })
    return new Uint8Array(await blob.arrayBuffer())
  }
  const blob: Blob = await new Promise((resolve, reject) => {
    ;(canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      type,
      quality,
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

function imageDataFrom(image: RawImage): ImageData {
  // Copied rather than viewed over the existing buffer: `RawImage.data` may be a view
  // into a larger allocation, and ImageData requires a plain ArrayBuffer backing.
  const clamped = new Uint8ClampedArray(image.data.length)
  clamped.set(image.data)
  return new ImageData(clamped, image.width, image.height)
}

export const browserCodec: ImageCodec = {
  async decodeJpeg(bytes) {
    const copy = new Uint8Array(bytes.length)
    copy.set(bytes)
    const blob = new Blob([copy], { type: 'image/jpeg' })
    const bitmap = await createImageBitmap(blob)
    try {
      const canvas = makeCanvas(bitmap.width, bitmap.height)
      const ctx = context2d(canvas)
      ctx.drawImage(bitmap, 0, 0)
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      return {
        width: bitmap.width,
        height: bitmap.height,
        data: new Uint8Array(data.data.buffer.slice(0)),
      }
    } finally {
      bitmap.close()
    }
  },

  async encodeJpeg(image, quality) {
    const canvas = makeCanvas(image.width, image.height)
    const ctx = context2d(canvas)
    // JPEG has no alpha. Compositing onto white matches how every viewer would show
    // it against a page, so transparent regions do not come out black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, image.width, image.height)
    const tmp = makeCanvas(image.width, image.height)
    context2d(tmp).putImageData(imageDataFrom(image), 0, 0)
    ctx.drawImage(tmp as CanvasImageSource, 0, 0)
    return canvasToBytes(canvas, 'image/jpeg', quality)
  },

  async resize(image, width, height) {
    if (width === image.width && height === image.height) return image
    const source = makeCanvas(image.width, image.height)
    context2d(source).putImageData(imageDataFrom(image), 0, 0)

    const target = makeCanvas(width, height)
    const ctx = context2d(target)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height)

    const data = ctx.getImageData(0, 0, width, height)
    return { width, height, data: new Uint8Array(data.data.buffer.slice(0)) }
  },
}
