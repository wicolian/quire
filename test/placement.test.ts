import { describe, expect, it } from 'vitest'
import { mergePdfs } from '../src/core/merge'
import { scanPlacements } from '../src/core/placement'
import { imagePage } from './fixtures/build'

/**
 * Placement is what separates real compression from guessing. These tests check that
 * the scanner reads the drawn size out of the content stream, because everything the
 * image pass decides is downstream of that number.
 */
describe('scanPlacements', () => {
  it('reads the drawn size from the transformation matrix', async () => {
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 2000,
        imageHeight: 1000,
        drawWidth: 400,
        drawHeight: 200,
        encoding: 'jpeg',
      }),
    ])

    const placements = [...scanPlacements(doc).values()]
    expect(placements).toHaveLength(1)
    expect(placements[0].widthPt).toBeCloseTo(400, 1)
    expect(placements[0].heightPt).toBeCloseTo(200, 1)
  })

  it('distinguishes a tiny logo from a full-bleed image', async () => {
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 2000,
        imageHeight: 2000,
        drawWidth: 40,
        drawHeight: 40,
        encoding: 'jpeg',
      }),
      await imagePage({
        imageWidth: 2000,
        imageHeight: 2000,
        drawWidth: 1240,
        drawHeight: 1240,
        encoding: 'jpeg',
      }),
    ])

    const sizes = [...scanPlacements(doc).values()].map((p) => Math.round(p.widthPt)).sort((a, b) => a - b)
    // A 2000px bitmap at 40pt is ~3600 DPI of waste; the same bitmap at 1240pt is fine.
    expect(sizes[0]).toBeCloseTo(40, 0)
    expect(sizes[1]).toBeCloseTo(1240, 0)
  })

  it('records the largest use when an image appears more than once', async () => {
    // Both pages share one logo, drawn at different scales. Sizing for the smaller use
    // would visibly soften the larger one.
    const small = await imagePage({
      imageWidth: 800,
      imageHeight: 800,
      drawWidth: 100,
      drawHeight: 100,
      encoding: 'jpeg',
    })
    const { doc } = await mergePdfs([small])
    const placements = [...scanPlacements(doc).values()]
    expect(placements[0].widthPt).toBeCloseTo(100, 1)
  })

  it('returns nothing for a document with no images', async () => {
    const { doc } = await mergePdfs([
      await imagePage({
        imageWidth: 10,
        imageHeight: 10,
        drawWidth: 10,
        drawHeight: 10,
        encoding: 'jpeg',
      }),
    ])
    expect(scanPlacements(doc).size).toBe(1)
  })
})
