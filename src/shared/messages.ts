import type { Arrangement, DocRef } from '../core/types'

/**
 * Per-user preferences, stored in figma.clientStorage rather than in the document.
 * Panel size and text size belong to the person, not to the file, so a teammate
 * opening the same document gets their own.
 */
export interface Prefs {
  /** Multiplier applied to the whole panel. 0.9, 1 or 1.15. */
  uiScale: number
  width: number
  height: number
}

export const DEFAULT_PREFS: Prefs = { uiScale: 1, width: 420, height: 640 }

/**
 * The wire protocol between the sandbox and the UI iframe.
 *
 * Everything here has to survive structured cloning, so: plain objects, arrays and
 * typed arrays only. Figma passes Uint8Array through intact, which is what lets the
 * exported PDF bytes cross the boundary without base64 round-tripping them.
 */

export type UiToMain =
  | { type: 'ui-ready' }
  | { type: 'refresh' }
  | { type: 'scan-file' }
  | { type: 'save-arrangement'; docId: string; arrangement: Arrangement }
  | { type: 'export-pages'; requestId: string; pageIds: string[] }
  /** The flatten fallback: re-export frames as JPEGs instead of vector PDFs. */
  | { type: 'export-pages-raster'; requestId: string; pageIds: string[]; scale: number }
  | { type: 'cancel-export'; requestId: string }
  | { type: 'resize'; width: number; height: number }
  | { type: 'set-prefs'; prefs: Prefs }
  | { type: 'notify'; message: string; error?: boolean }
  | { type: 'select-node'; nodeId: string }

export type MainToUi =
  | {
      type: 'selection'
      docs: DocRef[]
      /** Saved arrangement per document id, null when the document has none yet. */
      arrangements: Record<string, Arrangement | null>
    }
  | { type: 'scan-result'; docs: DocRef[]; arrangements: Record<string, Arrangement | null> }
  | { type: 'scan-progress'; done: number; total: number }
  | { type: 'page-exported'; requestId: string; pageId: string; bytes: Uint8Array }
  | { type: 'page-failed'; requestId: string; pageId: string; reason: string }
  | { type: 'export-done'; requestId: string }
  | { type: 'prefs'; prefs: Prefs }

export function postToUi(message: MainToUi): void {
  figma.ui.postMessage(message)
}

export function postToMain(message: UiToMain): void {
  parent.postMessage({ pluginMessage: message }, '*')
}
