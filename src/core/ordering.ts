import type { Arrangement, PageRef, SortMode } from './types'
import { EMPTY_ARRANGEMENT } from './types'

/**
 * Compare strings the way a person reads them: digit runs compare numerically, so
 * `D2-2` sorts before `D2-10` rather than after it. Ties break case-insensitively
 * first so `a` and `A` group together, then case-sensitively for stability.
 */
export function naturalCompare(a: string, b: string): number {
  const ax = a.toLowerCase()
  const bx = b.toLowerCase()
  let i = 0
  let j = 0

  while (i < ax.length && j < bx.length) {
    const ac = ax.charCodeAt(i)
    const bc = bx.charCodeAt(j)
    const aDigit = ac >= 48 && ac <= 57
    const bDigit = bc >= 48 && bc <= 57

    if (aDigit && bDigit) {
      // Consume both digit runs whole and compare them as numbers. Leading zeros
      // are ignored for value but used as a tiebreaker, so `01` and `1` are stable.
      let iEnd = i
      while (iEnd < ax.length && ax.charCodeAt(iEnd) >= 48 && ax.charCodeAt(iEnd) <= 57) iEnd++
      let jEnd = j
      while (jEnd < bx.length && bx.charCodeAt(jEnd) >= 48 && bx.charCodeAt(jEnd) <= 57) jEnd++

      const aNum = ax.slice(i, iEnd).replace(/^0+(?=\d)/, '')
      const bNum = bx.slice(j, jEnd).replace(/^0+(?=\d)/, '')
      if (aNum.length !== bNum.length) return aNum.length - bNum.length
      if (aNum !== bNum) return aNum < bNum ? -1 : 1

      i = iEnd
      j = jEnd
      continue
    }

    if (ac !== bc) return ac - bc
    i++
    j++
  }

  if (ax.length !== bx.length) return ax.length - bx.length
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Canvas reading order: top-to-bottom in rows, left-to-right within a row.
 *
 * Frames on the same visual row are rarely pixel-aligned, so rows are banded by a
 * tolerance derived from frame height. Without this, a frame nudged 3px up would
 * jump ahead of its whole row.
 */
export function canvasCompare(a: PageRef, b: PageRef): number {
  const tolerance = Math.max(a.height, b.height) * 0.5
  if (Math.abs(a.y - b.y) > tolerance) return a.y - b.y
  if (a.x !== b.x) return a.x - b.x
  return naturalCompare(a.name, b.name)
}

export function sortPages(pages: PageRef[], mode: SortMode): PageRef[] {
  const copy = pages.slice()
  switch (mode) {
    case 'alpha':
      return copy.sort((a, b) => naturalCompare(a.name, b.name))
    case 'alpha-desc':
      return copy.sort((a, b) => naturalCompare(b.name, a.name))
    case 'canvas':
      return copy.sort(canvasCompare)
    case 'manual':
      return copy
  }
}

export interface ReconciledOrder {
  /** Pages in export order, including excluded ones (the UI strikes those through). */
  pages: PageRef[]
  /** Ids of pages that were not in the saved arrangement — genuinely new frames. */
  newPageIds: string[]
  /** The arrangement with dangling ids pruned and new pages appended. */
  arrangement: Arrangement
}

/**
 * Reconcile a saved arrangement against the frames that actually exist right now.
 *
 * Three things can have happened since it was saved: frames deleted (drop them
 * silently — the user deleted them on purpose), frames added (append at the end and
 * flag them, because guessing where a new page belongs is worse than being obvious
 * about not knowing), frames renamed (ids are stable, so nothing to do).
 */
export function reconcile(pages: PageRef[], saved: Arrangement | null): ReconciledOrder {
  const byId = new Map(pages.map((p) => [p.id, p]))

  if (!saved || saved.order.length === 0) {
    const mode = saved?.sortMode ?? EMPTY_ARRANGEMENT.sortMode
    const sorted = sortPages(pages, mode === 'manual' ? 'canvas' : mode)
    return {
      pages: sorted,
      newPageIds: [],
      arrangement: {
        ...EMPTY_ARRANGEMENT,
        ...saved,
        sortMode: mode,
        order: sorted.map((p) => p.id),
        excluded: (saved?.excluded ?? []).filter((id) => byId.has(id)),
        breaks: (saved?.breaks ?? []).filter((id) => byId.has(id)),
      },
    }
  }

  const kept: PageRef[] = []
  const seen = new Set<string>()
  for (const id of saved.order) {
    const page = byId.get(id)
    if (page && !seen.has(id)) {
      kept.push(page)
      seen.add(id)
    }
  }

  // Anything the saved order never mentioned is new. Sort those among themselves so a
  // batch of newly-added frames still arrives in a sensible order.
  const added = sortPages(
    pages.filter((p) => !seen.has(p.id)),
    saved.sortMode === 'manual' ? 'canvas' : saved.sortMode,
  )

  const ordered = [...kept, ...added]
  return {
    pages: ordered,
    newPageIds: added.map((p) => p.id),
    arrangement: {
      version: 1,
      sortMode: saved.sortMode,
      order: ordered.map((p) => p.id),
      excluded: saved.excluded.filter((id) => byId.has(id)),
      breaks: saved.breaks.filter((id) => byId.has(id)),
    },
  }
}

/** Move a page within the order. Used by the drag handler. */
export function movePage(order: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= order.length) return order
  const next = order.slice()
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next
}

/**
 * Split an ordered page list into output groups at the break markers.
 *
 * A break sits *above* the page whose id is in `breaks`, so a break on the first page
 * is meaningless and is ignored rather than producing an empty leading group.
 */
export function groupByBreaks(pages: PageRef[], breaks: string[]): PageRef[][] {
  if (pages.length === 0) return []
  const breakSet = new Set(breaks)
  const groups: PageRef[][] = [[]]
  pages.forEach((page, index) => {
    if (index > 0 && breakSet.has(page.id)) groups.push([])
    groups[groups.length - 1].push(page)
  })
  return groups.filter((g) => g.length > 0)
}
