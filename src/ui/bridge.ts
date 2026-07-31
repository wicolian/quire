import type { MainToUi, UiToMain } from '../shared/messages'
import { postToMain } from '../shared/messages'

/**
 * Talking to the sandbox.
 *
 * The sandbox streams exported pages back one at a time rather than returning them as
 * a batch, so this collects them against a request id and resolves once the sandbox
 * says the run is finished.
 */

type Listener = (message: MainToUi) => void

const listeners = new Set<Listener>()

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data?.pluginMessage as MainToUi | undefined
  if (!message || typeof message.type !== 'string') return
  for (const listener of listeners) listener(message)
})

export function onMessage(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function send(message: UiToMain): void {
  postToMain(message)
}

export interface ExportCollection {
  bytes: Map<string, Uint8Array>
  failures: { pageId: string; reason: string }[]
}

let requestCounter = 0

function nextRequestId(): string {
  requestCounter += 1
  return `r${requestCounter}`
}

/**
 * Ask the sandbox for a set of pages and wait for all of them.
 *
 * `format: 'raster'` routes to the flatten fallback. Cancellation is cooperative: the
 * sandbox checks between pages, so this resolves with whatever arrived before the
 * cancel landed rather than rejecting.
 */
export function requestPages(
  pageIds: string[],
  options: {
    format?: 'pdf' | 'raster'
    scale?: number
    onPage?: (done: number, total: number, pageId: string) => void
    signal?: { cancelled: boolean }
  } = {},
): Promise<ExportCollection> {
  const requestId = nextRequestId()
  const bytes = new Map<string, Uint8Array>()
  const failures: { pageId: string; reason: string }[] = []
  let done = 0

  return new Promise((resolve) => {
    const stop = onMessage((message) => {
      if (!('requestId' in message) || message.requestId !== requestId) return

      if (message.type === 'page-exported') {
        bytes.set(message.pageId, message.bytes)
        done++
        options.onPage?.(done, pageIds.length, message.pageId)
        if (options.signal?.cancelled) send({ type: 'cancel-export', requestId })
        return
      }

      if (message.type === 'page-failed') {
        failures.push({ pageId: message.pageId, reason: message.reason })
        done++
        options.onPage?.(done, pageIds.length, message.pageId)
        return
      }

      if (message.type === 'export-done') {
        stop()
        resolve({ bytes, failures })
      }
    })

    if (options.format === 'raster') {
      send({ type: 'export-pages-raster', requestId, pageIds, scale: options.scale ?? 2 })
    } else {
      send({ type: 'export-pages', requestId, pageIds })
    }
  })
}

/** Let the browser paint between heavy synchronous stretches. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })
}
