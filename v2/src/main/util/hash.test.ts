import { describe, it, expect } from 'vitest'
import { hashString } from './hash'

describe('hashString', () => {
  it('is deterministic for the same input', () => {
    expect(hashString('0:5404|1:1234')).toBe(hashString('0:5404|1:1234'))
  })

  it('produces different hashes for different inputs', () => {
    expect(hashString('0:5404|1:1234')).not.toBe(hashString('0:5404|1:1235'))
  })

  it('never produces a leading minus sign', () => {
    // Run across a spread of inputs to catch sign-related edge cases.
    for (let i = 0; i < 50; i++) {
      expect(hashString(`disc-structure-${i}`)).not.toMatch(/^-/)
    }
  })

  it('handles an empty string without throwing', () => {
    expect(() => hashString('')).not.toThrow()
  })

  it('produces a compact base36 string', () => {
    const hash = hashString('some fairly long track fingerprint string here')
    expect(hash).toMatch(/^[0-9a-z]+$/)
    expect(hash.length).toBeLessThan(10)
  })
})
