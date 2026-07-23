import { describe, it, expect } from 'vitest'
import { sanitizeMusicFilename } from './sanitize'

describe('sanitizeMusicFilename', () => {
  it('replaces illegal filesystem characters with underscores', () => {
    expect(sanitizeMusicFilename('AC/DC')).toBe('AC_DC')
    expect(sanitizeMusicFilename('Now: The Album')).toBe('Now_ The Album')
  })

  it('strips a leading dot so the name is never a hidden dotfile', () => {
    expect(sanitizeMusicFilename('.38 Special')).toBe('38 Special')
  })

  it('strips trailing dots', () => {
    expect(sanitizeMusicFilename('Track Title...')).toBe('Track Title')
  })

  it('strips both leading and trailing dots on the same name', () => {
    expect(sanitizeMusicFilename('...Baby One More Time...')).toBe('Baby One More Time')
  })

  it('falls back to "Unknown" when sanitization empties the string', () => {
    expect(sanitizeMusicFilename('...')).toBe('Unknown')
    expect(sanitizeMusicFilename('')).toBe('Unknown')
  })

  it('leaves an already-safe name untouched', () => {
    expect(sanitizeMusicFilename('Abbey Road')).toBe('Abbey Road')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeMusicFilename('  Let It Be  ')).toBe('Let It Be')
  })
})
