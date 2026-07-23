import { describe, it, expect } from 'vitest'
import { parseCDToc } from './cd-toc-parser'

// Realistic cdparanoia -Q stderr output. Real cdparanoia reports track 1's
// raw "begin" LBA as 0 — not 150 — confirmed via cdparanoia's own source
// (it reports raw drive-relative LBA, matching the MusicBrainz spec's
// description of "LBA offsets start at address 0").
const REAL_CDPARANOIA_OUTPUT = `
cdparanoia III release 10.2 (September 11, 2008)

Table of contents (audio session, CDDB disc ID: 8d09750b):

track        length               begin        copy pre ch
===============================================================
  1.    18000 [04:00.00]        0 [00:00.00]    no   no  2
  2.    22350 [04:58.00]    18000 [04:00.00]    no   no  2
  3.    15675 [03:29.00]    40350 [08:58.00]    no   no  2
TOTAL    56025 [12:27.00]    (audio only)
`

describe('parseCDToc', () => {
  it('parses raw startSector/endSector exactly as reported (no shift) for rip-time use', () => {
    const info = parseCDToc(REAL_CDPARANOIA_OUTPUT, '/dev/disk4')!
    expect(info.tracks).toHaveLength(3)
    expect(info.tracks[0]).toMatchObject({ number: 1, startSector: 0, endSector: 17999 })
    expect(info.tracks[1]).toMatchObject({ number: 2, startSector: 18000, endSector: 40349 })
    expect(info.tracks[2]).toMatchObject({ number: 3, startSector: 40350, endSector: 56024 })
  })

  it('applies the +150 MusicBrainz lead-in offset to every track offset', () => {
    const info = parseCDToc(REAL_CDPARANOIA_OUTPUT, '/dev/disk4')!
    // Raw begin sectors are 0, 18000, 40350 — MB offsets must be +150 each.
    expect(info.trackOffsets).toEqual([150, 18150, 40500])
  })

  it('applies the +150 offset to the lead-out sector too', () => {
    const info = parseCDToc(REAL_CDPARANOIA_OUTPUT, '/dev/disk4')!
    // Last track ends at 56024, so raw lead-out is 56025; MB lead-out is +150.
    expect(info.leadOutSector).toBe(56175)
  })

  it('computes lead-out from the last track when the TOTAL line is absent', () => {
    const noTotal = REAL_CDPARANOIA_OUTPUT.split('\n').filter(l => !l.startsWith('TOTAL')).join('\n')
    const info = parseCDToc(noTotal, '/dev/disk4')!
    expect(info.leadOutSector).toBe(56175)
  })

  it('computes correct track durations in seconds (75 sectors/sec for audio)', () => {
    const info = parseCDToc(REAL_CDPARANOIA_OUTPUT, '/dev/disk4')!
    expect(info.tracks[0].durationSeconds).toBeCloseTo(240, 0) // 18000/75 = 240s = 4:00
    expect(info.totalDurationSeconds).toBeCloseTo(747, 0) // 56025/75 ≈ 12:27
  })

  it('returns null when no track lines are present', () => {
    expect(parseCDToc('no tracks here, drive error', '/dev/disk4')).toBeNull()
  })

  it('preserves the device path on the returned info', () => {
    const info = parseCDToc(REAL_CDPARANOIA_OUTPUT, '/dev/disk7')!
    expect(info.devicePath).toBe('/dev/disk7')
  })

  it('handles a single-track disc correctly', () => {
    const single = `
track        length               begin        copy pre ch
===============================================================
  1.    18000 [04:00.00]        0 [00:00.00]    no   no  2
TOTAL    18000 [04:00.00]    (audio only)
`
    const info = parseCDToc(single, '/dev/disk4')!
    expect(info.trackCount).toBe(1)
    expect(info.trackOffsets).toEqual([150])
    expect(info.leadOutSector).toBe(18150)
  })
})
