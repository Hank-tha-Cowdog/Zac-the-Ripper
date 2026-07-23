import { describe, it, expect } from 'vitest'
import { withDefinedPercentage } from './useJobProgress'

describe('withDefinedPercentage', () => {
  it('passes through a normal numeric percentage unchanged', () => {
    const result = withDefinedPercentage({ percentage: 42.5, message: 'Encoding...', status: 'running' })
    expect(result).toEqual({ percentage: 42.5, message: 'Encoding...', status: 'running' })
  })

  it('omits the percentage key entirely when undefined (the ffmpeg speed-only event)', () => {
    // This is the exact real-world shape: { jobId, speed, message } with no
    // percentage field at all, deserialized so d.percentage is undefined.
    const result = withDefinedPercentage({ percentage: undefined, message: 'Speed: 2.3x', speed: 2.3, status: 'running' })
    expect('percentage' in result).toBe(false)
    expect(result).toEqual({ message: 'Speed: 2.3x', speed: 2.3, status: 'running' })
  })

  it('omits the percentage key when it is NaN, not just when missing', () => {
    const result = withDefinedPercentage({ percentage: NaN, message: 'x', status: 'running' })
    expect('percentage' in result).toBe(false)
  })

  it('preserves 0 as a valid percentage (falsy but legitimate)', () => {
    const result = withDefinedPercentage({ percentage: 0, message: 'Starting...', status: 'running' })
    expect(result.percentage).toBe(0)
  })

  it('demonstrates the merge is a safe no-op against a store already holding a real percentage', () => {
    // Regression guard for the actual store-level bug: {...job, ...updates}
    // with a dropped key never overwrites the job's last known percentage.
    const job = { percentage: 55, message: 'old', status: 'running' as const }
    const updates = withDefinedPercentage({ percentage: undefined, message: 'Speed: 1.1x', speed: 1.1, status: 'running' })
    const merged = { ...job, ...updates }
    expect(merged.percentage).toBe(55)
  })
})
