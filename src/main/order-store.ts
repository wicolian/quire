import type { Arrangement } from '../core/types'

/**
 * Persisting a document's arrangement into the Figma file itself.
 *
 * `pluginData` is stored on the section node, so the order travels with the file: a
 * teammate opening the same document gets the same page order, and re-exporting in
 * three months does not mean re-dragging twelve rows.
 */

const KEY = 'quire.arrangement.v1'

/** pluginData values are capped; an arrangement is tiny, but be certain. */
const MAX_BYTES = 90_000

export async function readArrangement(docId: string): Promise<Arrangement | null> {
  // Ad-hoc selections have no node to read from.
  if (docId.startsWith('adhoc:')) return null

  try {
    const node = await figma.getNodeByIdAsync(docId)
    if (!node || node.removed) return null
    const raw = (node as SceneNode).getPluginData(KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Arrangement
    // A future version of this plugin may write a shape this one cannot read. Falling
    // back to "no saved order" is always safe; guessing at an unknown shape is not.
    if (parsed.version !== 1 || !Array.isArray(parsed.order)) return null

    return {
      version: 1,
      sortMode: parsed.sortMode ?? 'canvas',
      order: parsed.order.filter((id): id is string => typeof id === 'string'),
      excluded: Array.isArray(parsed.excluded) ? parsed.excluded.filter((id) => typeof id === 'string') : [],
      breaks: Array.isArray(parsed.breaks) ? parsed.breaks.filter((id) => typeof id === 'string') : [],
    }
  } catch {
    return null
  }
}

export async function writeArrangement(docId: string, arrangement: Arrangement): Promise<void> {
  if (docId.startsWith('adhoc:')) return

  try {
    const node = await figma.getNodeByIdAsync(docId)
    if (!node || node.removed) return

    const raw = JSON.stringify(arrangement)
    if (raw.length > MAX_BYTES) return

    ;(node as SceneNode).setPluginData(KEY, raw)
  } catch {
    // Writing the arrangement is a convenience, never a precondition for exporting.
    // A read-only file or a deleted node must not surface as an error.
  }
}

export async function readArrangements(docIds: string[]): Promise<Record<string, Arrangement | null>> {
  const result: Record<string, Arrangement | null> = {}
  for (const id of docIds) result[id] = await readArrangement(id)
  return result
}
