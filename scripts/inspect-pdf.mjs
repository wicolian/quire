import { readFileSync } from 'node:fs'
import { PDFDocument, PDFName, PDFRawStream, PDFRef, PDFDict, PDFArray } from 'pdf-lib'

/**
 * Dump the structure of a PDF: images, their filters, colour spaces, soft masks and
 * stream sizes, plus counts of transparency groups and graphics-state soft masks.
 *
 * Written while tracking down soft masks that were being flattened opaque. A soft mask
 * whose stream is near zero bytes is the tell: a constant buffer deflates to nothing,
 * so a shadow that reads as a hard block shows up here as a 0 KB mask.
 *
 *   node scripts/inspect-pdf.mjs some.pdf
 */
const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/inspect-pdf.mjs <file.pdf>')
  process.exit(1)
}
const doc = await PDFDocument.load(new Uint8Array(readFileSync(file)), { ignoreEncryption: true, updateMetadata: false })

const name = (v) => (v instanceof PDFName ? v.asString().replace(/^\//, '') : null)
const num = (v) => (v && 'asNumber' in v ? v.asNumber() : undefined)

console.log('FILE     ', file.split('/').pop())
console.log('pages    ', doc.getPageCount())
console.log('producer ', doc.getProducer(), '| creator', doc.getCreator())
console.log('bytes    ', (readFileSync(file).length / 1024 / 1024).toFixed(2), 'MB')

const images = []
let extGStateSMasks = 0
let transparencyGroups = 0

for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
  if (obj instanceof PDFRawStream) {
    const d = obj.dict
    if (name(d.get(PDFName.of('Subtype'))) === 'Image') {
      const filter = d.get(PDFName.of('Filter'))
      const filters = filter instanceof PDFArray
        ? filter.asArray().map(name).join('+')
        : name(filter)
      images.push({
        ref: ref.tag,
        w: num(d.get(PDFName.of('Width'))),
        h: num(d.get(PDFName.of('Height'))),
        filter: filters,
        cs: name(d.get(PDFName.of('ColorSpace'))) ?? (d.get(PDFName.of('ColorSpace')) ? 'array/ref' : null),
        bpc: num(d.get(PDFName.of('BitsPerComponent'))),
        smask: d.get(PDFName.of('SMask')) instanceof PDFRef ? 'yes' : 'no',
        mask: d.has(PDFName.of('Mask')) ? 'yes' : 'no',
        kb: (obj.contents.length / 1024).toFixed(0),
      })
    }
    // Form XObjects carrying a transparency group are how effects get isolated.
    if (name(d.get(PDFName.of('Subtype'))) === 'Form' && d.has(PDFName.of('Group'))) transparencyGroups++
  }
  if (obj instanceof PDFDict) {
    const t = name(obj.get(PDFName.of('Type')))
    if (t === 'ExtGState' && obj.has(PDFName.of('SMask'))) {
      const sm = obj.get(PDFName.of('SMask'))
      if (!(sm instanceof PDFName && sm.asString() === '/None')) extGStateSMasks++
    }
  }
}

console.log('images   ', images.length, '| ExtGState soft masks', extGStateSMasks, '| transparency groups', transparencyGroups)
console.table(images.slice(0, 24))
