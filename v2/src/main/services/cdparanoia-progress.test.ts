import { describe, it, expect } from 'vitest'
import { parseCdparanoiaProgressSector, cdparanoiaSectorToPercent } from './cdparanoia-progress'

describe('parseCdparanoiaProgressSector', () => {
  it('parses a real captured cdparanoia progress line', () => {
    // Verbatim sample captured from a real cdparanoia -e run.
    expect(parseCdparanoiaProgressSector('(== PROGRESS == [ | 009802 00 ] == :^D * ==)')).toBe(9802)
  })

  it('parses a line with a populated dispcache status string before the |', () => {
    expect(parseCdparanoiaProgressSector('(== PROGRESS == [.........---+++    | 020133 02 ] == :-P . ==)')).toBe(20133)
  })

  it('ignores the leading carriage return the real line is prefixed with', () => {
    expect(parseCdparanoiaProgressSector('\r (== PROGRESS == [ | 000150 00 ] == :-) . ==) ')).toBe(150)
  })

  it('returns null for unrelated cdparanoia output (not a progress line)', () => {
    expect(parseCdparanoiaProgressSector('outputting to track01.cdda.wav')).toBeNull()
    expect(parseCdparanoiaProgressSector('cdparanoia III release 10.2 (September 11, 2008)')).toBeNull()
  })

  it('does NOT match the old (never-real) "[XX.X%]" percentage format', () => {
    // Regression guard: the previous parser looked for this shape, which
    // cdparanoia has never actually emitted.
    expect(parseCdparanoiaProgressSector('(== PROGRESS ==) [42.0%]')).toBeNull()
  })
})

describe('cdparanoiaSectorToPercent', () => {
  it('computes 0% at the track start sector', () => {
    expect(cdparanoiaSectorToPercent(18000, 18000, 40349)).toBe(0)
  })

  it('computes ~100% at the last inclusive sector, exactly 100% one sector past it', () => {
    // endSector is inclusive (trackLength = end - start + 1), so the true
    // 100% boundary sits one sector past it, not at endSector itself.
    expect(cdparanoiaSectorToPercent(40349, 18000, 40349)).toBeCloseTo(100, 1)
    expect(cdparanoiaSectorToPercent(40350, 18000, 40349)).toBe(100)
  })

  it('computes a proportional midpoint', () => {
    // Track spans exactly 10000 sectors; 5000 in should be ~50%.
    expect(cdparanoiaSectorToPercent(23000, 18000, 27999)).toBeCloseTo(50, 0)
  })

  it('clamps below-range sectors to 0 rather than going negative', () => {
    expect(cdparanoiaSectorToPercent(100, 18000, 40349)).toBe(0)
  })

  it('clamps above-range sectors to 100 rather than exceeding it', () => {
    expect(cdparanoiaSectorToPercent(99999, 18000, 40349)).toBe(100)
  })

  it('does not divide by zero for a degenerate single-sector track', () => {
    expect(() => cdparanoiaSectorToPercent(100, 100, 100)).not.toThrow()
    expect(cdparanoiaSectorToPercent(100, 100, 100)).toBe(0)
  })
})
