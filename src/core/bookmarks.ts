import { PDFArray, PDFDict, PDFName, PDFNull, PDFNumber, PDFRef, PDFString, type PDFDocument } from 'pdf-lib'

/**
 * A PDF outline built from frame names.
 *
 * pdf-lib has no outline API, so this writes the object graph by hand. It is a flat,
 * single-level list — Figma frame names carry no hierarchy, and inventing one from
 * name prefixes would guess wrong the moment someone renames a frame.
 *
 * The structure the PDF spec requires:
 *
 *   Catalog ──/Outlines──► Outlines dict ──/First──► item 1 ──/Next──► item 2 ──► …
 *                                        ──/Last───► item N     ◄──/Prev──┘
 *   each item: /Title, /Parent, /Dest [page /XYZ null null null]
 */
export function addOutline(doc: PDFDocument, titles: string[]): void {
  const pages = doc.getPages()
  if (pages.length === 0 || titles.length === 0) return

  const context = doc.context
  const outlinesRef = context.nextRef()

  const itemRefs: PDFRef[] = []
  const count = Math.min(titles.length, pages.length)
  for (let i = 0; i < count; i++) itemRefs.push(context.nextRef())

  for (let i = 0; i < count; i++) {
    // "Top of the page at the current zoom" — /XYZ with nulls leaves the viewer's
    // zoom alone, which is what you want when clicking through a document.
    const destination = PDFArray.withContext(context)
    destination.push(pages[i].ref)
    destination.push(PDFName.of('XYZ'))
    destination.push(PDFNull)
    destination.push(PDFNull)
    destination.push(PDFNull)

    const item = PDFDict.withContext(context)
    item.set(PDFName.of('Title'), PDFString.of(titles[i]))
    item.set(PDFName.of('Parent'), outlinesRef)
    item.set(PDFName.of('Dest'), destination)
    if (i > 0) item.set(PDFName.of('Prev'), itemRefs[i - 1])
    if (i < count - 1) item.set(PDFName.of('Next'), itemRefs[i + 1])

    context.assign(itemRefs[i], item)
  }

  const outlines = PDFDict.withContext(context)
  outlines.set(PDFName.of('Type'), PDFName.of('Outlines'))
  outlines.set(PDFName.of('First'), itemRefs[0])
  outlines.set(PDFName.of('Last'), itemRefs[count - 1])
  // Positive Count means "open the sidebar with these visible".
  outlines.set(PDFName.of('Count'), PDFNumber.of(count))
  context.assign(outlinesRef, outlines)

  doc.catalog.set(PDFName.of('Outlines'), outlinesRef)
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
}
