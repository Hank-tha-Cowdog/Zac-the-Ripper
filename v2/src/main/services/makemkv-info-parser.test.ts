import { describe, it, expect } from 'vitest'
import { parseMakeMKVInfoLine, parseDuration, parseSize, type StreamTypeMap } from './makemkv-info-parser'
import type { DiscInfo, TrackInfo } from './disc-detection'

// Fixtures modeled on MakeMKV's real --robot info output. Attribute IDs
// follow MakeMKV's own AP_ItemAttributeId enum (apdefs.h): CINFO attr 1 =
// Type, 2 = Name, 32 = VolumeName. TINFO/SINFO share that numbering with an
// extra leading id field. SINFO's own type (Audio/Subtitles/Video) is
// declared once per stream via attrId=1, not re-sent on every line.

function freshState() {
  return {
    info: { tracks: [], metadata: {} } as Partial<DiscInfo>,
    trackMap: new Map<number, TrackInfo>(),
    streamTypeMap: new Map() as StreamTypeMap
  }
}

function feed(lines: string[]) {
  const state = freshState()
  for (const line of lines) {
    parseMakeMKVInfoLine(line, state.info, state.trackMap, state.streamTypeMap)
  }
  return state
}

describe('parseMakeMKVInfoLine — CINFO (disc-level)', () => {
  it('detects a Blu-ray disc from attr 1, not attr 28 (language code)', () => {
    const { info } = feed([
      'CINFO:1,0,"Blu-ray disc"',
      'CINFO:2,0,"Best in Show"',
      'CINFO:28,0,"eng"', // MetadataLanguageCode — must NOT influence discType
      'CINFO:32,0,"BEST_IN_SHOW"'
    ])
    expect(info.discType).toBe('BD')
    expect(info.title).toBe('Best in Show')
    expect(info.discId).toBe('BEST_IN_SHOW')
  })

  it('detects a DVD disc from attr 1', () => {
    const { info } = feed([
      'CINFO:1,0,"DVD disc"',
      'CINFO:2,0,"BEST_IN_SHOW"',
      'CINFO:32,0,"BEST_IN_SHOW"'
    ])
    expect(info.discType).toBe('DVD')
  })

  it('detects UHD Blu-ray via the Ultra HD substring', () => {
    const { info } = feed(['CINFO:1,0,"Blu-ray disc (Ultra HD)"'])
    expect(info.discType).toBe('UHD_BD')
  })

  it('does not misdetect a disc as Blu-ray just because attr 28 happens to be empty/absent', () => {
    // Regression case for the original bug: with no attr-1 line at all
    // (simulating an unexpected/truncated scan), discType must stay
    // undefined here rather than defaulting via a leftover attr-28 check —
    // the caller (getDiscInfoViaMakeMKV) is responsible for the DVD fallback
    // default, not this parser.
    const { info } = feed(['CINFO:2,0,"Some Disc"', 'CINFO:28,0,"eng"'])
    expect(info.discType).toBeUndefined()
  })

  it('uses attr 32 (VolumeName) for discId, not attr 30 (TreeInfo)', () => {
    const { info } = feed([
      'CINFO:30,0,""', // TreeInfo — often empty; must NOT become discId
      'CINFO:32,0,"MY_VOLUME_LABEL"'
    ])
    expect(info.discId).toBe('MY_VOLUME_LABEL')
  })
})

describe('parseMakeMKVInfoLine — TINFO (track-level)', () => {
  it('creates a track and populates title/duration/size/chapters/resolution/framerate', () => {
    const { trackMap } = feed([
      'TINFO:0,2,0,"Main Movie"',
      'TINFO:0,9,0,"1:33:04"',
      'TINFO:0,10,0,"7.1 GB"',
      'TINFO:0,8,0,"35"',
      'TINFO:0,19,0,"720x480"',
      'TINFO:0,21,0,"29.97"'
    ])
    const track = trackMap.get(0)!
    expect(track.title).toBe('Main Movie')
    expect(track.duration).toBe('1:33:04')
    expect(track.durationSeconds).toBe(3600 + 33 * 60 + 4)
    expect(track.chapters).toBe(35)
    expect(track.resolution).toBe('720x480')
    expect(track.framerate).toBe('29.97')
  })

  it('tracks multiple titles independently', () => {
    const { trackMap } = feed([
      'TINFO:0,2,0,"Title A"',
      'TINFO:1,2,0,"Title B"'
    ])
    expect(trackMap.get(0)!.title).toBe('Title A')
    expect(trackMap.get(1)!.title).toBe('Title B')
  })
})

describe('parseMakeMKVInfoLine — SINFO (stream-level dispatch)', () => {
  // Attribute IDs below are verified against real `makemkvcon --robot info`
  // output (a registered copy scanning a real DVD, "Best in Show") — the
  // ORIGINAL versions of these tests used made-up attribute IDs (2→codec,
  // 4→channels, 5→bitrate for audio; 2→codec for subtitles) that were never
  // checked against a real MakeMKV run, and they happened to validate a
  // parser that was actually reading the wrong fields: codec held the
  // channel-layout name, channels held the language name, bitrate held the
  // codec id, and every subtitle stream silently got type='unknown' because
  // attr 2 is never emitted for subtitle streams at all. Real excerpt for
  // one 5.1 AC3 English track:
  //   SINFO:0,1,2,0,"Surround 5.1"   attr 2  = Name (channel-layout label)
  //   SINFO:0,1,3,0,"eng"            attr 3  = Lang Code
  //   SINFO:0,1,4,0,"English"        attr 4  = Lang Name
  //   SINFO:0,1,5,0,"A_AC3"          attr 5  = Codec Id
  //   SINFO:0,1,6,0,"DD"             attr 6  = Codec Short
  //   SINFO:0,1,7,0,"Dolby Digital"  attr 7  = Codec Long
  //   SINFO:0,1,13,0,"384 Kb/s"      attr 13 = Bitrate
  //   SINFO:0,1,14,0,"6"             attr 14 = Channel count
  it('routes audio attributes to audioTracks, not the video stream', () => {
    const { trackMap } = feed([
      'TINFO:0,2,0,"Main Movie"',
      'SINFO:0,0,1,0,"Video"',
      'SINFO:0,0,7,0,"MPEG-2 Video"', // must be ignored — video, not audio/subtitle
      'SINFO:0,1,1,0,"Audio"',
      'SINFO:0,1,2,0,"Surround 5.1"',
      'SINFO:0,1,3,0,"eng"',
      'SINFO:0,1,4,0,"English"',
      'SINFO:0,1,5,0,"A_AC3"',
      'SINFO:0,1,6,0,"DD"',
      'SINFO:0,1,7,0,"Dolby Digital"',
      'SINFO:0,1,13,0,"384 Kb/s"',
      'SINFO:0,1,14,0,"6"'
    ])
    const track = trackMap.get(0)!
    expect(track.audioTracks).toHaveLength(1)
    expect(track.audioTracks[0]).toMatchObject({
      id: 1, codec: 'Dolby Digital', language: 'eng', channels: '6', bitrate: '384 Kb/s'
    })
    // The video stream's own attribute (stream id 0) must not leak into audioTracks.
    expect(track.audioTracks.find(a => a.id === 0)).toBeUndefined()
  })

  it('falls back to Codec Short / Codec Id if a later, more descriptive codec attribute is empty', () => {
    const { trackMap } = feed([
      'TINFO:0,2,0,"Main Movie"',
      'SINFO:0,1,1,0,"Audio"',
      'SINFO:0,1,5,0,"A_AC3"',
      'SINFO:0,1,6,0,""', // Codec Short empty this time — must not blank out the Id
      'SINFO:0,1,7,0,""'  // Codec Long empty too — must still keep the last non-empty value
    ])
    expect(trackMap.get(0)!.audioTracks[0].codec).toBe('A_AC3')
  })

  it('routes subtitle attributes to subtitleTracks using Codec Id (attr 5), not Name (attr 2)', () => {
    const { trackMap } = feed([
      'TINFO:0,2,0,"Main Movie"',
      'SINFO:0,3,1,0,"Subtitles"',
      'SINFO:0,3,3,0,"eng"',
      'SINFO:0,3,5,0,"S_VOBSUB"'
    ])
    const track = trackMap.get(0)!
    expect(track.subtitleTracks).toHaveLength(1)
    expect(track.subtitleTracks[0]).toMatchObject({ id: 3, type: 'vobsub', language: 'eng', codec: 'S_VOBSUB' })
  })

  it('handles a realistic full title with video + 2 audio + 1 subtitle stream', () => {
    const { trackMap } = feed([
      'TINFO:0,2,0,"Main Movie"',
      'SINFO:0,0,1,0,"Video"',
      'SINFO:0,1,1,0,"Audio"',
      'SINFO:0,1,3,0,"eng"',
      'SINFO:0,1,5,0,"A_AC3"',
      'SINFO:0,1,7,0,"Dolby Digital"',
      'SINFO:0,2,1,0,"Audio"',
      'SINFO:0,2,3,0,"fre"',
      'SINFO:0,2,5,0,"A_AC3"',
      'SINFO:0,2,7,0,"Dolby Digital"',
      'SINFO:0,3,1,0,"Subtitles"',
      'SINFO:0,3,3,0,"eng"',
      'SINFO:0,3,5,0,"S_VOBSUB"'
    ])
    const track = trackMap.get(0)!
    expect(track.audioTracks).toHaveLength(2)
    expect(track.audioTracks.map(a => a.language).sort()).toEqual(['eng', 'fre'])
    expect(track.subtitleTracks).toHaveLength(1)
    expect(track.subtitleTracks[0].language).toBe('eng')
  })

  it('keeps streams from different tracks (titles) separate', () => {
    const { trackMap } = feed([
      'TINFO:0,2,0,"Title A"',
      'TINFO:1,2,0,"Title B"',
      'SINFO:0,1,1,0,"Audio"',
      'SINFO:0,1,3,0,"eng"',
      'SINFO:1,1,1,0,"Audio"',
      'SINFO:1,1,3,0,"jpn"'
    ])
    expect(trackMap.get(0)!.audioTracks[0].language).toBe('eng')
    expect(trackMap.get(1)!.audioTracks[0].language).toBe('jpn')
  })

  it('ignores attributes for a stream whose type line has not arrived yet', () => {
    const { trackMap } = feed([
      'TINFO:0,2,0,"Main Movie"',
      // attrId=3 arrives before attrId=1 for this stream (out-of-order,
      // shouldn't happen in practice, but must not crash or misclassify)
      'SINFO:0,1,3,0,"eng"'
    ])
    const track = trackMap.get(0)!
    expect(track.audioTracks).toHaveLength(0)
    expect(track.subtitleTracks).toHaveLength(0)
  })

  it('silently drops SINFO lines for an unknown track id', () => {
    expect(() => feed(['SINFO:99,0,1,0,"Audio"'])).not.toThrow()
  })

  it('recognizes VOBSUB and closed-caption subtitle codec strings (real, verified values)', () => {
    // "S_CC608/DVD" verified directly; PGS's real Blu-ray codec id was not
    // directly observed this session (this disc is a DVD) but follows the
    // same verified S_<FORMAT> uppercase convention as VOBSUB/CC608/AC3.
    const cases: Array<[string, string]> = [
      ['S_VOBSUB', 'vobsub'], ['S_HDMV/PGS', 'pgs'], ['S_TEXT/UTF8', 'srt'],
      ['S_CC608/DVD', 'cc608'], ['S_CC708/DVD', 'cc708']
    ]
    for (const [codecValue, expectedType] of cases) {
      const { trackMap } = feed([
        'TINFO:0,2,0,"T"',
        'SINFO:0,0,1,0,"Subtitles"',
        `SINFO:0,0,5,0,"${codecValue}"`
      ])
      expect(trackMap.get(0)!.subtitleTracks[0].type).toBe(expectedType)
    }
  })

  it('matches real captured SINFO output verbatim for a 3-audio/3-subtitle DVD main feature', () => {
    // Verbatim excerpt from a real `makemkvcon --robot info` scan of a
    // registered copy against a real disc (not a hand-written fixture).
    const { trackMap } = feed([
      'TINFO:0,2,0,"BEST IN SHOW"',
      'SINFO:0,0,1,6201,"Video"',
      'SINFO:0,0,5,0,"V_MPEG2"',
      'SINFO:0,1,1,6202,"Audio"',
      'SINFO:0,1,2,0,"Surround 5.1"',
      'SINFO:0,1,3,0,"eng"',
      'SINFO:0,1,4,0,"English"',
      'SINFO:0,1,5,0,"A_AC3"',
      'SINFO:0,1,6,0,"DD"',
      'SINFO:0,1,7,0,"Dolby Digital"',
      'SINFO:0,1,13,0,"384 Kb/s"',
      'SINFO:0,1,14,0,"6"',
      'SINFO:0,2,1,6202,"Audio"',
      'SINFO:0,2,3,0,"fre"',
      'SINFO:0,2,4,0,"French"',
      'SINFO:0,2,5,0,"A_AC3"',
      'SINFO:0,2,6,0,"DD"',
      'SINFO:0,2,7,0,"Dolby Digital"',
      'SINFO:0,2,13,0,"384 Kb/s"',
      'SINFO:0,2,14,0,"6"',
      'SINFO:0,3,1,6202,"Audio"',
      'SINFO:0,3,3,0,"eng"',
      'SINFO:0,3,5,0,"A_AC3"',
      'SINFO:0,3,6,0,"DD"',
      'SINFO:0,3,7,0,"Dolby Digital"',
      'SINFO:0,3,13,0,"192 Kb/s"',
      'SINFO:0,3,14,0,"2"',
      'SINFO:0,4,1,6203,"Subtitles"',
      'SINFO:0,4,3,0,"eng"',
      'SINFO:0,4,5,0,"S_VOBSUB"',
      'SINFO:0,5,1,6203,"Subtitles"',
      'SINFO:0,5,3,0,"fre"',
      'SINFO:0,5,5,0,"S_VOBSUB"',
      'SINFO:0,6,1,6203,"Subtitles"',
      'SINFO:0,6,3,0,"eng"',
      'SINFO:0,6,5,0,"S_CC608/DVD"'
    ])
    const track = trackMap.get(0)!
    expect(track.audioTracks).toEqual([
      { id: 1, codec: 'Dolby Digital', language: 'eng', channels: '6', bitrate: '384 Kb/s' },
      { id: 2, codec: 'Dolby Digital', language: 'fre', channels: '6', bitrate: '384 Kb/s' },
      { id: 3, codec: 'Dolby Digital', language: 'eng', channels: '2', bitrate: '192 Kb/s' }
    ])
    expect(track.subtitleTracks).toEqual([
      { id: 4, type: 'vobsub', language: 'eng', codec: 'S_VOBSUB' },
      { id: 5, type: 'vobsub', language: 'fre', codec: 'S_VOBSUB' },
      { id: 6, type: 'cc608', language: 'eng', codec: 'S_CC608/DVD' }
    ])
  })
})

describe('parseMakeMKVInfoLine — MSG-adjacent quoting edge cases', () => {
  it('does not let a value containing a comma break field alignment', () => {
    const { info } = feed(['CINFO:2,0,"Movie, The"'])
    expect(info.title).toBe('Movie, The')
  })
})

describe('parseDuration', () => {
  it('parses h:mm:ss', () => {
    expect(parseDuration('1:33:04')).toBe(3600 + 33 * 60 + 4)
  })
  it('parses mm:ss', () => {
    expect(parseDuration('5:30')).toBe(5 * 60 + 30)
  })
  it('returns 0 for garbage input', () => {
    expect(parseDuration('')).toBe(0)
  })
})

describe('parseSize', () => {
  it('converts GB/MB/KB to bytes', () => {
    expect(parseSize('7.1 GB')).toBeCloseTo(7.1 * 1073741824, 0)
    expect(parseSize('512 MB')).toBe(512 * 1048576)
    expect(parseSize('10 KB')).toBe(10 * 1024)
  })
  it('returns 0 for unparseable input', () => {
    expect(parseSize('unknown')).toBe(0)
  })
})
