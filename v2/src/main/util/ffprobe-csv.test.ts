import { describe, it, expect } from 'vitest'
import { hasRecognizedVideoStream } from './ffprobe-csv'

describe('hasRecognizedVideoStream', () => {
  it('accepts a real main-feature VTS (mpeg2video, recognized codec)', () => {
    // Captured verbatim from `ffprobe -select_streams v -show_entries
    // stream=codec_type,codec_name -of csv=p=0` against the "Best in Show"
    // test disc's VTS_01_1.VOB (the main feature).
    expect(hasRecognizedVideoStream('mpeg2video,video')).toBe(true)
  })

  it('rejects a real bonus-content VTS with an unrecognized video codec', () => {
    // Captured verbatim from the same query against VTS_02_1.VOB (a bonus
    // feature on the same disc) — a stream ffprobe types as "video" but
    // cannot identify the actual codec for. This is the exact case that
    // slipped through the old codec_type-only check and only failed later,
    // mid-rip, with ffmpeg's "Could not find codec parameters" error.
    expect(hasRecognizedVideoStream('unknown,video')).toBe(false)
  })

  it('rejects when there is no video stream at all', () => {
    expect(hasRecognizedVideoStream('')).toBe(false)
  })

  it('accepts if any of multiple lines has a recognized video codec', () => {
    expect(hasRecognizedVideoStream('unknown,video\nmpeg2video,video')).toBe(true)
  })
})
