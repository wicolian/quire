import type { OutputFile } from '../core/types'
import { zipFiles } from '../core/zip'
import { sanitizeStem } from '../core/naming'

/**
 * Getting bytes out of the plugin.
 *
 * A plugin iframe has no filesystem access, so the only route out is an object URL and
 * a synthetic click. Browsers reliably permit one download per user gesture, which is
 * why several files become a single ZIP rather than several clicks.
 */

function triggerDownload(bytes: Uint8Array, filename: string, mime: string): void {
  // Copy into a fresh buffer: the underlying ArrayBuffer may be a view into a larger
  // allocation, and Blob would otherwise capture the whole thing.
  const blob = new Blob([bytes.slice()], { type: mime })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)

  // Revoking immediately can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function deliver(files: OutputFile[], docName: string): { filename: string } | null {
  if (files.length === 0) return null

  if (files.length === 1) {
    triggerDownload(files[0].bytes, files[0].filename, 'application/pdf')
    return { filename: files[0].filename }
  }

  const filename = `${sanitizeStem(docName, 'Document')}.zip`
  triggerDownload(zipFiles(files), filename, 'application/zip')
  return { filename }
}
