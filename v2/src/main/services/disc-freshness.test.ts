import { describe, it, expect } from 'vitest'
import { validateDiscFreshness } from './disc-freshness'
import type { DiscInfo, TrackInfo } from './disc-detection'

function track(id: number): TrackInfo {
  return {
    id, title: `Title ${id}`, duration: '01:00:00', durationSeconds: 3600,
    size: '1 GB', sizeBytes: 1_000_000_000, chapters: 1, resolution: '1920x1080',
    framerate: '23.976', isInterlaced: false, audioTracks: [], subtitleTracks: []
  }
}

function disc(overrides: Partial<DiscInfo> = {}): DiscInfo {
  return {
    title: 'Test Disc', discType: 'DVD', discId: 'abc123', fingerprint: 'fp1',
    trackCount: 3, tracks: [track(0), track(1), track(2)], metadata: {},
    ...overrides
  }
}

describe('validateDiscFreshness', () => {
  it('allows a rip when the selected tracks exist on the currently-scanned disc', () => {
    const result = validateDiscFreshness({ discInfo: disc(), expectedDiscId: 'abc123', titleIds: [0, 2] })
    expect(result.valid).toBe(true)
  })

  it('rejects when no disc is currently in the drive (ejected)', () => {
    const result = validateDiscFreshness({ discInfo: null, expectedDiscId: 'abc123', titleIds: [0] })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain('No disc detected')
  })

  it('rejects when the disc in the drive is a different disc than the one tracks were selected on', () => {
    const result = validateDiscFreshness({
      discInfo: disc({ discId: 'different-disc-xyz' }),
      expectedDiscId: 'abc123',
      titleIds: [0]
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain('disc in the drive has changed')
  })

  it('rejects when a selected title ID does not exist on the current disc', () => {
    const result = validateDiscFreshness({ discInfo: disc(), expectedDiscId: 'abc123', titleIds: [0, 99] })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain('99')
  })

  it('always allows ingest mode — there is no physical disc to have changed', () => {
    const result = validateDiscFreshness({ isIngest: true, discInfo: null, titleIds: [0, 1, 2] })
    expect(result.valid).toBe(true)
  })

  it('allows the rip when no expectedDiscId was submitted (older/partial callers) as long as titles exist', () => {
    // expectedDiscId is optional — a caller that doesn't send it still gets
    // the title-existence check, just not the stronger identity check.
    const result = validateDiscFreshness({ discInfo: disc(), titleIds: [1] })
    expect(result.valid).toBe(true)
  })

  it('reports every unknown title id, not just the first', () => {
    const result = validateDiscFreshness({ discInfo: disc(), expectedDiscId: 'abc123', titleIds: [0, 50, 99] })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('50')
      expect(result.error).toContain('99')
      expect(result.error).not.toContain('[0,')
    }
  })
})
