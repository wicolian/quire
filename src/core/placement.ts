import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFContext,
  type PDFDocument,
} from 'pdf-lib'

/**
 * How large is each embedded image actually *drawn*?
 *
 * This is the difference between compressing well and compressing blindly. A 2000px
 * logo placed at 40pt is being displayed at 3600 DPI and is almost pure waste; the
 * same 2000px bitmap spanning a full A4 page is a reasonable 240 DPI and should be
 * left nearly alone. Pixel dimensions alone cannot tell those apart — only the
 * transformation matrix in force at the `Do` operator can.
 *
 * So: tokenize the content stream, track the graphics state the way a PDF renderer
 * would, and record the largest size each image is painted at.
 */

/** A 2D affine matrix as PDF writes it: [a b c d e f]. */
type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** m1 concatenated with m2 — `cm` premultiplies onto the current matrix. */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ]
}

/**
 * An image XObject is painted into the unit square, so the matrix columns give the
 * on-page edge lengths directly. Rotation and skew fall out of the hypotenuse.
 */
function drawnSize(ctm: Matrix): { width: number; height: number } {
  return {
    width: Math.hypot(ctm[0], ctm[1]),
    height: Math.hypot(ctm[2], ctm[3]),
  }
}

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'other' }

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])

function isRegular(byte: number): boolean {
  return !WHITESPACE.has(byte) && !DELIMITERS.has(byte)
}

/**
 * Minimal content-stream tokenizer.
 *
 * Only numbers, names and operators matter here, but strings, dictionaries and inline
 * images still have to be *skipped correctly* — binary data inside an inline image
 * would otherwise be read as operators and derail the graphics state.
 */
function* tokenize(bytes: Uint8Array): Generator<Token> {
  let i = 0
  const length = bytes.length

  while (i < length) {
    const byte = bytes[i]

    if (WHITESPACE.has(byte)) {
      i++
      continue
    }

    // Comment
    if (byte === 0x25) {
      while (i < length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++
      continue
    }

    // Literal string — track nesting and backslash escapes.
    if (byte === 0x28) {
      i++
      let depth = 1
      while (i < length && depth > 0) {
        if (bytes[i] === 0x5c) {
          i += 2
          continue
        }
        if (bytes[i] === 0x28) depth++
        else if (bytes[i] === 0x29) depth--
        i++
      }
      yield { kind: 'other' }
      continue
    }

    // Dictionary or hex string
    if (byte === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        i += 2
        let depth = 1
        while (i < length && depth > 0) {
          if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) {
            depth++
            i += 2
          } else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
            depth--
            i += 2
          } else {
            i++
          }
        }
      } else {
        while (i < length && bytes[i] !== 0x3e) i++
        i++
      }
      yield { kind: 'other' }
      continue
    }

    // Array brackets carry no meaning for us; their contents tokenize normally.
    if (byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d || byte === 0x3e || byte === 0x29) {
      i++
      continue
    }

    // Name
    if (byte === 0x2f) {
      i++
      const start = i
      while (i < length && isRegular(bytes[i])) i++
      let raw = ''
      for (let k = start; k < i; k++) raw += String.fromCharCode(bytes[k])
      // Names may contain #xx escapes.
      yield { kind: 'name', value: raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) }
      continue
    }

    // Number or operator
    const start = i
    while (i < length && isRegular(bytes[i])) i++
    if (i === start) {
      i++
      continue
    }
    let text = ''
    for (let k = start; k < i; k++) text += String.fromCharCode(bytes[k])

    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) {
      yield { kind: 'number', value: Number.parseFloat(text) }
      continue
    }

    if (text === 'BI') {
      // Inline image: skip past the binary payload to the EI marker. Reading it as
      // tokens would corrupt every operator that follows.
      while (i < length) {
        if (
          bytes[i] === 0x45 &&
          bytes[i + 1] === 0x49 &&
          (i + 2 >= length || WHITESPACE.has(bytes[i + 2]))
        ) {
          i += 2
          break
        }
        i++
      }
      continue
    }

    yield { kind: 'op', value: text }
  }
}

/** Decode a stream's bytes, tolerating filters we cannot handle. */
function streamBytes(stream: PDFRawStream): Uint8Array | null {
  try {
    return decodePDFRawStream(stream).decode()
  } catch {
    return null
  }
}

function lookupDict(context: PDFContext, value: unknown): PDFDict | null {
  const resolved = value instanceof PDFRef ? context.lookup(value) : value
  if (resolved instanceof PDFDict) return resolved
  if (resolved instanceof PDFRawStream) return resolved.dict
  return null
}

/** Largest painted size of one image, in PDF points. */
export interface Placement {
  widthPt: number
  heightPt: number
}

/** ref tag → largest placement found anywhere in the document. */
export type PlacementMap = Map<string, Placement>

function record(map: PlacementMap, ref: PDFRef, size: { width: number; height: number }): void {
  const existing = map.get(ref.tag)
  if (!existing) {
    map.set(ref.tag, { widthPt: size.width, heightPt: size.height })
    return
  }
  // An image used twice at different scales must be sized for its largest use, or the
  // big one goes soft.
  map.set(ref.tag, {
    widthPt: Math.max(existing.widthPt, size.width),
    heightPt: Math.max(existing.heightPt, size.height),
  })
}

function scanStream(
  context: PDFContext,
  bytes: Uint8Array,
  resources: PDFDict | null,
  baseCtm: Matrix,
  map: PlacementMap,
  depth: number,
): void {
  if (depth > 6) return

  let ctm = baseCtm
  const stack: Matrix[] = []
  let operands: number[] = []
  let lastName: string | null = null

  for (const token of tokenize(bytes)) {
    if (token.kind === 'number') {
      operands.push(token.value)
      if (operands.length > 8) operands.shift()
      continue
    }
    if (token.kind === 'name') {
      lastName = token.value
      continue
    }
    if (token.kind === 'other') continue

    switch (token.value) {
      case 'q':
        stack.push(ctm)
        break
      case 'Q':
        ctm = stack.pop() ?? IDENTITY
        break
      case 'cm':
        if (operands.length >= 6) {
          const m = operands.slice(-6) as Matrix
          ctm = multiply(m, ctm)
        }
        break
      case 'Do': {
        if (!lastName || !resources) break
        const xobjects = lookupDict(context, resources.get(PDFName.of('XObject')))
        if (!xobjects) break
        const entry = xobjects.get(PDFName.of(lastName))
        if (!(entry instanceof PDFRef)) break
        const target = context.lookup(entry)
        if (!(target instanceof PDFRawStream)) break

        const subtype = target.dict.get(PDFName.of('Subtype'))
        const subtypeName = subtype instanceof PDFName ? subtype.asString().replace(/^\//, '') : ''

        if (subtypeName === 'Image') {
          record(map, entry, drawnSize(ctm))
        } else if (subtypeName === 'Form') {
          // A form carries its own matrix and resource dictionary; images inside it
          // are placed relative to both.
          const formMatrix = target.dict.get(PDFName.of('Matrix'))
          let inner = ctm
          if (formMatrix instanceof PDFArray && formMatrix.size() === 6) {
            const values: number[] = []
            for (let k = 0; k < 6; k++) {
              const n = formMatrix.get(k)
              values.push(n instanceof PDFNumber ? n.asNumber() : 0)
            }
            inner = multiply(values as Matrix, ctm)
          }
          const formResources =
            lookupDict(context, target.dict.get(PDFName.of('Resources'))) ?? resources
          const decoded = streamBytes(target)
          if (decoded) scanStream(context, decoded, formResources, inner, map, depth + 1)
        }
        break
      }
      default:
        break
    }

    operands = []
    if (token.value !== 'Do') lastName = null
    else lastName = null
  }
}

/**
 * Walk every page and report how large each image XObject is painted.
 *
 * Images that never appear in the returned map could not be located — the caller
 * treats those conservatively (see `images.ts`) rather than guessing.
 */
export function scanPlacements(doc: PDFDocument): PlacementMap {
  const map: PlacementMap = new Map()
  const context = doc.context

  for (const page of doc.getPages()) {
    const resources = lookupDict(context, page.node.get(PDFName.of('Resources')))
    const contents = page.node.get(PDFName.of('Contents'))

    const streams: PDFRawStream[] = []
    const push = (value: unknown) => {
      const resolved = value instanceof PDFRef ? context.lookup(value) : value
      if (resolved instanceof PDFRawStream) streams.push(resolved)
    }

    if (contents instanceof PDFRef) {
      const resolved = context.lookup(contents)
      if (resolved instanceof PDFArray) {
        for (let i = 0; i < resolved.size(); i++) push(resolved.get(i))
      } else {
        push(contents)
      }
    } else if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) push(contents.get(i))
    }

    // Content split across multiple streams is one logical stream; the graphics state
    // carries across the boundary, so they are concatenated rather than scanned apart.
    const decoded: Uint8Array[] = []
    for (const stream of streams) {
      const bytes = streamBytes(stream)
      if (bytes) decoded.push(bytes)
    }
    if (decoded.length === 0) continue

    let combined: Uint8Array
    if (decoded.length === 1) {
      combined = decoded[0]
    } else {
      const total = decoded.reduce((sum, b) => sum + b.length + 1, 0)
      combined = new Uint8Array(total)
      let offset = 0
      for (const bytes of decoded) {
        combined.set(bytes, offset)
        offset += bytes.length
        combined[offset] = 0x0a
        offset += 1
      }
    }

    scanStream(context, combined, resources, IDENTITY, map, 0)
  }

  return map
}
