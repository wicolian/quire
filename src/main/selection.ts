import type { DocRef, PageRef } from '../core/types'

/**
 * Turning what the user has selected into documents and pages.
 *
 * The mapping is: a section is a document, and the frame-like nodes directly inside it
 * are its pages. Nested frames are ignored, those are the contents of a page, not
 * pages themselves.
 */

/** Node types that can stand as a page. Everything else is page *content*. */
const PAGE_TYPES = new Set<string>(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP'])

function isPageNode(node: SceneNode): boolean {
  return PAGE_TYPES.has(node.type)
}

function toPageRef(node: SceneNode): PageRef {
  return {
    id: node.id,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }
}

function sectionToDoc(section: SectionNode, canvasPage: PageNode): DocRef {
  return {
    id: section.id,
    name: section.name,
    canvasPageId: canvasPage.id,
    canvasPageName: canvasPage.name,
    pages: section.children.filter(isPageNode).map(toPageRef),
    adHoc: false,
  }
}

/**
 * Read the current selection.
 *
 * Three cases, in priority order: sections selected (the intended path), loose frames
 * selected (treated as one ad-hoc document so the plugin still does something useful),
 * or nothing usable (empty list, and the UI shows its empty state).
 */
export function readSelection(): DocRef[] {
  const canvasPage = figma.currentPage
  const selection = canvasPage.selection

  const sections = selection.filter((node): node is SectionNode => node.type === 'SECTION')
  if (sections.length > 0) {
    return sections.map((section) => sectionToDoc(section, canvasPage))
  }

  const frames = selection.filter(isPageNode)
  if (frames.length > 0) {
    return [
      {
        // An ad-hoc selection has no stable identity to hang saved order off, so it
        // is keyed by the current page. Reordering it is not persisted, which the UI
        // says out loud rather than pretending otherwise.
        id: `adhoc:${canvasPage.id}`,
        name: frames.length === 1 ? frames[0].name : canvasPage.name,
        canvasPageId: canvasPage.id,
        canvasPageName: canvasPage.name,
        pages: frames.map(toPageRef),
        adHoc: true,
      },
    ]
  }

  return []
}

/**
 * Walk the whole file for sections.
 *
 * Under `documentAccess: dynamic-page` the other canvas pages are not loaded until
 * asked for, so this is genuinely expensive on a large file, hence it is an explicit
 * button rather than something that happens on open.
 */
export async function scanFile(onProgress?: (done: number, total: number) => void): Promise<DocRef[]> {
  await figma.loadAllPagesAsync()

  const docs: DocRef[] = []
  const canvasPages = figma.root.children
  let done = 0

  for (const canvasPage of canvasPages) {
    for (const node of canvasPage.children) {
      if (node.type === 'SECTION') {
        const doc = sectionToDoc(node, canvasPage)
        // A section with no frames in it is not a document; listing it would just be
        // noise in the scan results.
        if (doc.pages.length > 0) docs.push(doc)
      }
    }
    done++
    onProgress?.(done, canvasPages.length)
  }

  return docs
}

/**
 * Export one node as a single-page PDF.
 *
 * Returns null rather than throwing: one unexportable frame must not cost the user
 * the other eleven.
 */
export async function exportPagePdf(nodeId: string): Promise<Uint8Array | { error: string }> {
  try {
    const node = await figma.getNodeByIdAsync(nodeId)
    if (!node) return { error: 'Frame no longer exists' }
    if (!('exportAsync' in node)) return { error: 'Frame cannot be exported' }
    return await (node as ExportMixin).exportAsync({ format: 'PDF' })
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Export one node as a JPEG for the flatten fallback.
 *
 * Figma's renderer produces a far better raster than anything the plugin could do to
 * a PDF in JS, which is why flattening goes back to the document rather than trying
 * to rasterize the merged file.
 */
export async function exportPageRaster(
  nodeId: string,
  scale: number,
): Promise<Uint8Array | { error: string }> {
  try {
    const node = await figma.getNodeByIdAsync(nodeId)
    if (!node) return { error: 'Frame no longer exists' }
    if (!('exportAsync' in node)) return { error: 'Frame cannot be exported' }
    return await (node as ExportMixin).exportAsync({
      format: 'JPG',
      constraint: { type: 'SCALE', value: scale },
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
