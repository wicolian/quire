import type { Prefs, UiToMain } from '../shared/messages'
import { DEFAULT_PREFS, postToUi } from '../shared/messages'
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

const PREFS_KEY = 'quire.prefs.v1'

const LIMITS = { minWidth: 320, maxWidth: 900, minHeight: 380, maxHeight: 1200 }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function sanitizePrefs(raw: unknown): Prefs {
  const prefs = (raw ?? {}) as Partial<Prefs>
  return {
    // Anything outside the offered set means a corrupt or hand-edited value.
    uiScale: [0.9, 1, 1.15].includes(prefs.uiScale as number)
      ? (prefs.uiScale as number)
      : DEFAULT_PREFS.uiScale,
    width: clamp(prefs.width ?? DEFAULT_PREFS.width, LIMITS.minWidth, LIMITS.maxWidth),
    height: clamp(prefs.height ?? DEFAULT_PREFS.height, LIMITS.minHeight, LIMITS.maxHeight),
  }
}

/**
 * The panel opens at its stored size before anything is rendered, so it never appears
 * at the default and then jumps.
 */
async function boot(): Promise<void> {
  let prefs = DEFAULT_PREFS
  try {
    prefs = sanitizePrefs(await figma.clientStorage.getAsync(PREFS_KEY))
  } catch {
    // First run, or storage unavailable. Defaults are correct in both cases.
  }

  figma.showUI(__html__, {
    width: prefs.width,
    height: prefs.height,
    themeColors: true,
    title: 'Quire',
  })

  postToUi({ type: 'prefs', prefs })
}

void boot()

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
      // Clamped so a stray drag cannot leave the panel unusably small or absurdly big.
      figma.ui.resize(
        clamp(message.width, LIMITS.minWidth, LIMITS.maxWidth),
        clamp(message.height, LIMITS.minHeight, LIMITS.maxHeight),
      )
      break

    case 'set-prefs': {
      const prefs = sanitizePrefs(message.prefs)
      try {
        await figma.clientStorage.setAsync(PREFS_KEY, prefs)
      } catch {
        // Losing a preference is not worth interrupting an export over.
      }
      break
    }

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
