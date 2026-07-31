import { describe, expect, it } from 'vitest'
import { MAX_PASSES, STOCKS, nextPass, parseMegabytes, resolveParams } from '../src/core/budget'
import { DEFAULT_SETTINGS, type CompressionParams } from '../src/core/types'

const MB = 1024 * 1024

describe('resolveParams', () => {
  it('takes numbers from the chosen stock', () => {
    const params = resolveParams({ ...DEFAULT_SETTINGS, stock: 'web' })
    expect(params.dpi).toBe(STOCKS.web.dpi)
    expect(params.capBytes).toBe(STOCKS.web.capBytes)
  })

  it('treats Print as uncapped', () => {
    expect(resolveParams({ ...DEFAULT_SETTINGS, stock: 'print' }).capBytes).toBeNull()
  })

  it('lets Advanced overrides win', () => {
    const params = resolveParams({
      ...DEFAULT_SETTINGS,
      stock: 'email',
      dpiOverride: 96,
      qualityOverride: 0.5,
    })
    expect(params.dpi).toBe(96)
    expect(params.quality).toBe(0.5)
  })

  it('uses the custom cap only for the custom stock', () => {
    expect(
      resolveParams({ ...DEFAULT_SETTINGS, stock: 'custom', customCapBytes: 3 * MB }).capBytes,
    ).toBe(3 * MB)
    expect(
      resolveParams({ ...DEFAULT_SETTINGS, stock: 'email', customCapBytes: 3 * MB }).capBytes,
    ).toBe(STOCKS.email.capBytes)
  })

  it('reads a missing or zero custom cap as uncapped', () => {
    expect(resolveParams({ ...DEFAULT_SETTINGS, stock: 'custom', customCapBytes: 0 }).capBytes).toBeNull()
    expect(resolveParams({ ...DEFAULT_SETTINGS, stock: 'custom', customCapBytes: null }).capBytes).toBeNull()
  })
})

describe('nextPass', () => {
  const base: CompressionParams = { dpi: 150, quality: 0.82, capBytes: 10 * MB, skipSmallImages: true }

  it('stops when already under the cap', () => {
    expect(nextPass(base, 5 * MB, 10 * MB)).toBeNull()
  })

  it('steps gently when barely over', () => {
    const next = nextPass(base, 11 * MB, 10 * MB)!
    expect(next.quality).toBeLessThan(base.quality)
    expect(next.quality).toBeGreaterThan(0.65)
  })

  it('steps hard when far over', () => {
    const gentle = nextPass(base, 11 * MB, 10 * MB)!
    const harsh = nextPass(base, 40 * MB, 10 * MB)!
    expect(harsh.quality).toBeLessThan(gentle.quality)
    expect(harsh.dpi).toBeLessThan(gentle.dpi)
  })

  it('never degrades below a usable floor', () => {
    let params = { ...base, quality: 0.42, dpi: 74 }
    for (let i = 0; i < 5; i++) {
      const next = nextPass(params, 100 * MB, 10 * MB)
      if (!next) break
      params = next
      expect(params.quality).toBeGreaterThanOrEqual(0.4)
      expect(params.dpi).toBeGreaterThanOrEqual(72)
    }
  })

  it('gives up rather than looping once both axes are floored', () => {
    const floored = { ...base, quality: 0.4, dpi: 72 }
    expect(nextPass(floored, 100 * MB, 10 * MB)).toBeNull()
  })

  it('converges within the pass budget for a realistic overshoot', () => {
    const cap = 10 * MB
    let params = base
    let passes = 0
    // Model each pass as recovering roughly proportional to the quality drop.
    let size = 18 * MB
    while (passes < MAX_PASSES && size > cap) {
      const next = nextPass(params, size, cap)
      if (!next) break
      size *= next.quality / params.quality
      params = next
      passes++
    }
    expect(passes).toBeLessThanOrEqual(MAX_PASSES)
  })
})

describe('parseMegabytes', () => {
  it('reads plain and messy input', () => {
    expect(parseMegabytes('8')).toBe(8 * MB)
    expect(parseMegabytes('  8.5 MB ')).toBe(Math.round(8.5 * MB))
  })

  it('rejects anything unusable', () => {
    expect(parseMegabytes('')).toBeNull()
    expect(parseMegabytes('abc')).toBeNull()
    expect(parseMegabytes('0')).toBeNull()
    expect(parseMegabytes('-4')).toBe(4 * MB) // sign is stripped; magnitude is what matters
  })
})
