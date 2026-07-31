import { describe, expect, it } from 'vitest'
import {
  canvasCompare,
  groupByBreaks,
  movePage,
  naturalCompare,
  reconcile,
  sortPages,
} from '../src/core/ordering'
import type { Arrangement, PageRef } from '../src/core/types'

function page(id: string, name: string, x = 0, y = 0): PageRef {
  return { id, name, x, y, width: 1240, height: 1754 }
}

describe('naturalCompare', () => {
  it('orders digit runs numerically, not lexically', () => {
    // The whole reason this exists: plain string sort puts D2-10 before D2-2.
    const names = ['D2-10 Factor 7', 'D2-2 Introduction', 'D2-1 Cover']
    expect(names.slice().sort(naturalCompare)).toEqual([
      'D2-1 Cover',
      'D2-2 Introduction',
      'D2-10 Factor 7',
    ])
  })

  it("handles the reference document's zero-padded names", () => {
    const names = ['D2-12 Closing', 'D2-01 Cover', 'D2-03 Comparison table', 'D2-02 Introduction']
    expect(names.slice().sort(naturalCompare)).toEqual([
      'D2-01 Cover',
      'D2-02 Introduction',
      'D2-03 Comparison table',
      'D2-12 Closing',
    ])
  })

  it('treats padded and unpadded numbers as equal in value', () => {
    expect(naturalCompare('Page 007', 'Page 7')).not.toBe(0)
    expect(['Page 7', 'Page 007', 'Page 8'].sort(naturalCompare)[2]).toBe('Page 8')
  })

  it('groups by letter first, then settles case deterministically', () => {
    // Case must not scatter the letters: all the As together, then all the Bs.
    expect(['b', 'A', 'a', 'B'].sort(naturalCompare)).toEqual(['A', 'a', 'B', 'b'])
  })
})

describe('canvasCompare', () => {
  it('reads left-to-right within a row', () => {
    const pages = [page('c', 'C', 2000, 0), page('a', 'A', 0, 0), page('b', 'B', 1000, 0)]
    expect(sortPages(pages, 'canvas').map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('reads top-to-bottom across rows', () => {
    const pages = [page('r2', 'R2', 0, 2000), page('r1', 'R1', 5000, 0)]
    expect(sortPages(pages, 'canvas').map((p) => p.id)).toEqual(['r1', 'r2'])
  })

  it('keeps a slightly misaligned frame in its own row', () => {
    // A frame nudged a few pixels up must not jump ahead of its whole row.
    const a = page('a', 'A', 0, 0)
    const b = page('b', 'B', 1400, -6)
    expect(canvasCompare(a, b)).toBeLessThan(0)
  })
})

describe('reconcile', () => {
  // Laid out left to right, so canvas order is decided by position rather than by
  // whatever these names happen to sort as.
  const pages = [page('1', 'One', 0, 0), page('2', 'Two', 1400, 0), page('3', 'Three', 2800, 0)]

  it('falls back to canvas order with no saved arrangement', () => {
    const result = reconcile(pages, null)
    expect(result.pages.map((p) => p.id)).toEqual(['1', '2', '3'])
    expect(result.newPageIds).toEqual([])
  })

  it('restores a saved manual order', () => {
    const saved: Arrangement = {
      version: 1,
      sortMode: 'manual',
      order: ['3', '1', '2'],
      excluded: [],
      breaks: [],
    }
    expect(reconcile(pages, saved).pages.map((p) => p.id)).toEqual(['3', '1', '2'])
  })

  it('drops ids for frames that were deleted', () => {
    const saved: Arrangement = {
      version: 1,
      sortMode: 'manual',
      order: ['3', 'gone', '1', '2'],
      excluded: ['gone'],
      breaks: ['gone'],
      }
    const result = reconcile(pages, saved)
    expect(result.pages.map((p) => p.id)).toEqual(['3', '1', '2'])
    expect(result.arrangement.excluded).toEqual([])
    expect(result.arrangement.breaks).toEqual([])
  })

  it('appends genuinely new frames at the end and flags them', () => {
    const saved: Arrangement = {
      version: 1,
      sortMode: 'manual',
      order: ['1', '2'],
      excluded: [],
      breaks: [],
    }
    const result = reconcile(pages, saved)
    expect(result.pages.map((p) => p.id)).toEqual(['1', '2', '3'])
    expect(result.newPageIds).toEqual(['3'])
  })

  it('survives a duplicated id in a saved order', () => {
    const saved: Arrangement = {
      version: 1,
      sortMode: 'manual',
      order: ['1', '1', '2', '3'],
      excluded: [],
      breaks: [],
    }
    expect(reconcile(pages, saved).pages.map((p) => p.id)).toEqual(['1', '2', '3'])
  })
})

describe('movePage', () => {
  it('moves an item forward', () => {
    expect(movePage(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item backward', () => {
    expect(movePage(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('is a no-op when nothing moves', () => {
    const order = ['a', 'b']
    expect(movePage(order, 1, 1)).toBe(order)
  })
})

describe('groupByBreaks', () => {
  const pages = [page('1', 'One'), page('2', 'Two'), page('3', 'Three'), page('4', 'Four')]

  it('returns one group with no breaks', () => {
    expect(groupByBreaks(pages, [])).toHaveLength(1)
  })

  it('splits above each break', () => {
    const groups = groupByBreaks(pages, ['2', '4'])
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([['1'], ['2', '3'], ['4']])
  })

  it('ignores a break on the first page rather than emitting an empty group', () => {
    expect(groupByBreaks(pages, ['1'])).toHaveLength(1)
  })
})
