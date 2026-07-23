import { describe, it, expect } from 'vitest'
import { detectBitDepth } from './bit-depth'

describe('detectBitDepth', () => {
  it('falls back to pix_fmt when bits_per_raw_sample is absent — the real-world case', () => {
    // Verified directly: ffprobe on real hevc_videotoolbox 10-bit output
    // (yuv420p10le) omits bits_per_raw_sample from its JSON entirely.
    expect(detectBitDepth('yuv420p10le', undefined)).toBe(10)
  })

  it('trusts bits_per_raw_sample when ffprobe does report it', () => {
    expect(detectBitDepth('yuv420p10le', '10')).toBe(10)
    expect(detectBitDepth('yuv420p10le', 10)).toBe(10)
  })

  it('defaults to 8-bit for a plain pix_fmt with no bit-depth suffix', () => {
    expect(detectBitDepth('yuv420p', undefined)).toBe(8)
  })

  it('parses 12-bit and other depths from pix_fmt', () => {
    expect(detectBitDepth('yuv420p12le', undefined)).toBe(12)
    expect(detectBitDepth('yuv422p10le', undefined)).toBe(10)
    expect(detectBitDepth('yuv444p10le', undefined)).toBe(10)
  })

  it('handles big-endian pix_fmt suffixes too', () => {
    expect(detectBitDepth('yuv420p10be', undefined)).toBe(10)
  })

  it('ignores a non-numeric or zero bits_per_raw_sample and falls back to pix_fmt', () => {
    expect(detectBitDepth('yuv420p10le', 'N/A')).toBe(10)
    expect(detectBitDepth('yuv420p10le', 0)).toBe(10)
  })
})
