import type { UiToMain } from '../shared/messages'
import { postToUi } from '../shared/messages'
import { readArrangements, writeArrangement } from './order-store'
import { exportPagePdf, exportPageRaster, readSelection, scanFile } from './selection'

/**
 * The sandbox half of Quire.
 *
 * This realm owns the Figma document and nothing else. It reads the selection, reads
 * and writes saved arrangements, and turns nodes into PDF bytes. Every decision about
 * what those bytes become happens in the UI realm, which is where the code that can
 * be tested lives.
 */

const PANEL = { width: 420, height: 640 }

figma.showUI(__html__, { ...PANEL, themeColors: true, title: 'Quire' })

/** Export runs that have been abandoned; their remaining pages are skipped. */
const cancelled = new Set<string>()

async function sendSelection(): Promise<void> {
  const docs = readSelection()
  const arrangements = await readArrangements(docs.map((doc) => doc.id))
  postToUi({ type: 'selection', docs, arrangements })
}

/**
 * Export the requested pages one at a time, streaming each result as it lands.
 *
 * Sequential on purpose. Exporting twelve A4 frames in parallel spikes memory inside
 * Figma's own process, and the UI wants them in order anyway to drive the progress
 * indicator. One at a time also means cancelling actually stops work promptly.
 */
async function exportPages(
  requestId: string,
  pageIds: string[],
  raster: number | null = null,
): Promise<void> {
  for (const pageId of pageIds) {
    if (cancelled.has(requestId)) break

    const result = raster === null ? await exportPagePdf(pageId) : await exportPageRaster(pageId, raster)
    if (result instanceof Uint8Array) {
      postToUi({ type: 'page-exported', requestId, pageId, bytes: result })
    } else {
      postToUi({ type: 'page-failed', requestId, pageId, reason: result.error })
    }
  }

  cancelled.delete(requestId)
  postToUi({ type: 'export-done', requestId })
}

figma.ui.onmessage = async (message: UiToMain) => {
  switch (message.type) {
    case 'ui-ready':
    case 'refresh':
      await sendSelection()
      break

    case 'scan-file': {
      const docs = await scanFile((done, total) => {
        postToUi({ type: 'scan-progress', done, total })
      })
      const arrangements = await readArrangements(docs.map((doc) => doc.id))
      postToUi({ type: 'scan-result', docs, arrangements })
      break
    }

    case 'save-arrangement':
      await writeArrangement(message.docId, message.arrangement)
      break

    case 'export-pages':
      await exportPages(message.requestId, message.pageIds)
      break

    case 'export-pages-raster':
      await exportPages(message.requestId, message.pageIds, message.scale)
      break

    case 'cancel-export':
      cancelled.add(message.requestId)
      break

    case 'resize':
      // Clamped so a stray drag cannot leave the panel unusably small.
      figma.ui.resize(
        Math.max(360, Math.round(message.width)),
        Math.max(400, Math.round(message.height)),
      )
      break

    case 'notify':
      figma.notify(message.message, { error: message.error, timeout: message.error ? 6000 : 3000 })
      break

    case 'select-node': {
      // Clicking a row in the panel should show you the frame it means.
      const node = await figma.getNodeByIdAsync(message.nodeId)
      if (node && !node.removed && 'x' in node) {
        figma.currentPage.selection = [node as SceneNode]
        figma.viewport.scrollAndZoomIntoView([node as SceneNode])
      }
      break
    }
  }
}

// The panel tracks the canvas: select a different section and the list follows.
figma.on('selectionchange', () => {
  void sendSelection()
})

figma.on('currentpagechange', () => {
  void sendSelection()
})
