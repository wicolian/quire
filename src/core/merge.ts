import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib'

/**
 * Merging N single-page PDFs into one document, then removing what the merge
 * duplicated.
 *
 * Figma exports one PDF per frame, so a logo that appears on all 12 pages arrives as
 * 12 byte-identical streams. `copyPages` has no way to know they are the same thing,
 * so it faithfully embeds all 12. Collapsing them is the single largest saving
 * available on a vector document, and it is lossless.
 *
 * Fonts mostly will not dedupe: Figma subsets per export, so page 1's Inter subset is
 * usually not byte-identical to page 5's. Genuinely merging subsetted fonts is a much
 * harder problem and deliberately out of scope.
 */

export interface MergeResult {
  doc: PDFDocument
  /** Page order preserved, one entry per source PDF that loaded successfully. */
  pageRefs: PDFRef[]
  failed: { index: number; reason: string }[]
}

export async function mergePdfs(sources: Uint8Array[]): Promise<MergeResult> {
  const doc = await PDFDocument.create()
  const pageRefs: PDFRef[] = []
  const failed: { index: number; reason: string }[] = []

  for (let index = 0; index < sources.length; index++) {
    try {
      // Figma's own output is well-formed, but a single malformed page must not cost
      // the user the whole export.
      const src = await PDFDocument.load(sources[index], {
        ignoreEncryption: true,
        updateMetadata: false,
      })
      const copied = await doc.copyPages(src, src.getPageIndices())
      for (const page of copied) {
        doc.addPage(page)
        pageRefs.push(page.ref)
      }
    } catch (error) {
      failed.push({ index, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  return { doc, pageRefs, failed }
}

/** Streams that carry file structure rather than content, and must never be merged. */
const STRUCTURAL_TYPES = new Set(['ObjStm', 'XRef'])

/**
 * A stable string identity for a dictionary.
 *
 * References are written as their tag, so two dicts pointing at genuinely different
 * objects never compare equal. This is why dedupe runs to a fixed point below: once
 * a nested object (say, an /SMask) is collapsed, its parents' signatures become equal
 * on the following pass.
 */
function signature(obj: PDFObject | undefined, depth = 0): string {
  if (obj === undefined) return 'u'
  if (depth > 12) return 'deep'
  if (obj instanceof PDFRef) return `R${obj.tag}`
  if (obj instanceof PDFArray) {
    const parts: string[] = []
    for (let i = 0; i < obj.size(); i++) parts.push(signature(obj.get(i), depth + 1))
    return `[${parts.join(' ')}]`
  }
  if (obj instanceof PDFDict) {
    const parts: string[] = []
    for (const [key, value] of obj.entries()) parts.push(`${key.asString()}${signature(value, depth + 1)}`)
    parts.sort()
    return `<<${parts.join('')}>>`
  }
  return obj.toString()
}

/** FNV-1a over bytes, used only to bucket candidates, equality is byte-exact. */
function hashBytes(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function hashString(text: string, seed: number): number {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i) & 0xff
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function isStructural(stream: PDFRawStream): boolean {
  const type = stream.dict.get(PDFName.of('Type'))
  return type instanceof PDFName && STRUCTURAL_TYPES.has(type.asString().replace(/^\//, ''))
}

/** Rewrite every reference to a duplicate so it points at the surviving object. */
function rewire(obj: PDFObject, replacements: Map<string, PDFRef>, seen: Set<PDFObject>): void {
  if (obj instanceof PDFDict) {
    if (seen.has(obj)) return
    seen.add(obj)
    for (const [key, value] of obj.entries()) {
      if (value instanceof PDFRef) {
        const target = replacements.get(value.tag)
        if (target) obj.set(key, target)
      } else {
        rewire(value, replacements, seen)
      }
    }
    return
  }

  if (obj instanceof PDFArray) {
    if (seen.has(obj)) return
    seen.add(obj)
    for (let i = 0; i < obj.size(); i++) {
      const value = obj.get(i)
      if (value instanceof PDFRef) {
        const target = replacements.get(value.tag)
        if (target) obj.set(i, target)
      } else {
        rewire(value, replacements, seen)
      }
    }
  }
}

function dedupePass(context: PDFContext): number {
  const buckets = new Map<number, { ref: PDFRef; stream: PDFRawStream; sig: string }[]>()
  const replacements = new Map<string, PDFRef>()
  let bytesSaved = 0

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    // Restricted to raw streams on purpose. Deduping page objects or the page tree
    // would produce a structurally invalid document, and streams are where all the
    // weight is anyway.
    if (!(obj instanceof PDFRawStream)) continue
    if (isStructural(obj)) continue

    const sig = signature(obj.dict)
    const key = hashBytes(obj.contents, hashString(sig, 0x811c9dc5))
    const bucket = buckets.get(key)

    if (!bucket) {
      buckets.set(key, [{ ref, stream: obj, sig }])
      continue
    }

    const twin = bucket.find((c) => c.sig === sig && bytesEqual(c.stream.contents, obj.contents))
    if (twin) {
      replacements.set(ref.tag, twin.ref)
      bytesSaved += obj.contents.length
    } else {
      bucket.push({ ref, stream: obj, sig })
    }
  }

  if (replacements.size === 0) return 0

  const seen = new Set<PDFObject>()
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) rewire(obj.dict, replacements, seen)
    else rewire(obj, replacements, seen)
  }

  for (const tag of replacements.keys()) {
    const [num, gen] = tag.split(' ')
    context.delete(PDFRef.of(Number(num), Number(gen)))
  }

  return bytesSaved
}

/**
 * Collapse identical streams, repeating until nothing more collapses.
 *
 * Runs to a fixed point because dedupe is layered: collapsing a shared /SMask makes
 * its two parent images identical, which only becomes visible on the next pass. Three
 * passes covers every nesting depth Figma actually produces; the loop exits early the
 * moment a pass finds nothing.
 */
export function dedupeStreams(doc: PDFDocument, maxPasses = 3): number {
  let total = 0
  for (let pass = 0; pass < maxPasses; pass++) {
    const saved = dedupePass(doc.context)
    if (saved === 0) break
    total += saved
  }
  return total
}
