import { zipSync } from 'fflate'
import type { OutputFile } from './types'

/**
 * Bundle multiple PDFs into one download.
 *
 * A browser will only reliably trigger one download per user gesture, so emitting
 * twelve separate files would either be blocked as a popup or silently drop most of
 * them. One ZIP is the only dependable way out of an iframe.
 *
 * Stored, not deflated: PDFs are already compressed, so deflating them again spends
 * real time on a file that is often several megabytes to save a fraction of a percent.
 */
export function zipFiles(files: OutputFile[]): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {}
  for (const file of files) {
    entries[file.filename] = [file.bytes, { level: 0 }]
  }
  return zipSync(entries, { level: 0 })
}

/** Name the ZIP after the document it came from. */
export function zipName(docName: string, sanitize: (name: string) => string): string {
  return `${sanitize(docName)}.zip`
}
