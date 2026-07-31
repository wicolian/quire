import { describe, expect, it } from 'vitest'
import { formatBytes, outputFilenames, sanitizeStem, uniqueFilenames } from '../src/core/naming'

// Long dashes are written as escapes rather than as literal characters. They are the
// thing under test, and a literal one is easy to mangle with a find-and-replace over
// the repo, which silently turns these into tests of nothing.
const EM = '\u2014'
const EN = '\u2013'

describe('sanitizeStem', () => {
  it('keeps the reference document name readable', () => {
    expect(sanitizeStem(`Doc 2 ${EM} Databrain and Lightdash`)).toBe('Doc-2-Databrain-and-Lightdash')
  })

  it('normalizes every dash variant to a plain hyphen', () => {
    expect(sanitizeStem(`A ${EM} B`)).toBe('A-B')
    expect(sanitizeStem(`A ${EN} B`)).toBe('A-B')
    expect(sanitizeStem('A \u2212 B')).toBe('A-B')
  })

  it('strips characters that break filesystems', () => {
    expect(sanitizeStem('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
  })

  it('collapses runs of whitespace and dashes', () => {
    expect(sanitizeStem(`Too    many ${EM}${EM} gaps`)).toBe('Too-many-gaps')
  })

  it('trims leading and trailing punctuation', () => {
    expect(sanitizeStem('---Cover...')).toBe('Cover')
  })

  it('falls back when nothing usable survives', () => {
    expect(sanitizeStem('///')).toBe('Untitled')
    expect(sanitizeStem('', 'Document')).toBe('Document')
  })

  it('escapes Windows reserved device names', () => {
    expect(sanitizeStem('CON')).toBe('CON-file')
    expect(sanitizeStem('nul')).toBe('nul-file')
  })

  it('bounds length so a collision suffix still fits', () => {
    expect(sanitizeStem('x'.repeat(300)).length).toBeLessThanOrEqual(100)
  })
})

describe('uniqueFilenames', () => {
  it('suffixes collisions rather than silently overwriting', () => {
    // Two frames both called "Cover" must not resolve to one file.
    expect(uniqueFilenames(['Cover', 'Cover', 'Cover'])).toEqual([
      'Cover.pdf',
      'Cover-2.pdf',
      'Cover-3.pdf',
    ])
  })

  it('treats case-insensitive collisions as collisions', () => {
    expect(uniqueFilenames(['Cover', 'cover'])).toEqual(['Cover.pdf', 'cover-2.pdf'])
  })
})

describe('outputFilenames', () => {
  const groups = [[{ name: 'D2-01 Cover' }], [{ name: 'D2-02 Introduction' }, { name: 'D2-03 Table' }]]

  it('uses the document name for a single combined file', () => {
    expect(
      outputFilenames(`Doc 2 ${EM} Databrain and Lightdash`, [groups.flat()], 'combined'),
    ).toEqual(['Doc-2-Databrain-and-Lightdash.pdf'])
  })

  it('numbers split groups and names them after their first page', () => {
    expect(outputFilenames('Doc 2', groups, 'combined')).toEqual([
      'Doc-2_1-D2-01-Cover.pdf',
      'Doc-2_2-D2-02-Introduction.pdf',
    ])
  })

  it('names per-page files after the frames themselves', () => {
    expect(outputFilenames('Doc 2', groups, 'split')).toEqual([
      'D2-01-Cover.pdf',
      'D2-02-Introduction.pdf',
      'D2-03-Table.pdf',
    ])
  })
})

describe('formatBytes', () => {
  it('scales units the way file size limits are written', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(4.2 * 1024 * 1024)).toBe('4.2 MB')
  })
})
