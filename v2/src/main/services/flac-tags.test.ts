import { describe, it, expect } from 'vitest'
import { buildFlacEncodeArgs, type FlacTagContext } from './flac-tags'

function baseCtx(overrides: Partial<FlacTagContext> = {}): FlacTagContext {
  return {
    wavPath: '/tmp/01.wav',
    outputPath: '/tmp/01.flac',
    coverArtPath: null,
    compressionLevel: '8',
    trackTitle: 'Track One',
    trackArtist: 'The Artist',
    trackNumber: 1,
    totalTracks: 10,
    album: 'The Album',
    albumArtist: 'The Artist',
    year: '1999',
    discNumber: 1,
    totalDiscs: 1,
    ...overrides
  }
}

function metadataValue(args: string[], key: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-metadata' && args[i + 1]?.startsWith(`${key}=`)) {
      return args[i + 1].slice(key.length + 1)
    }
  }
  return undefined
}

describe('buildFlacEncodeArgs', () => {
  it('always encodes to FLAC at the requested compression level', () => {
    const args = buildFlacEncodeArgs(baseCtx({ compressionLevel: '5' }))
    const codecIndex = args.indexOf('-c:a')
    expect(args[codecIndex + 1]).toBe('flac')
    const levelIndex = args.indexOf('-compression_level')
    expect(args[levelIndex + 1]).toBe('5')
  })

  it('tags the basic fields (title, artist, album, albumartist, track, date)', () => {
    const args = buildFlacEncodeArgs(baseCtx())
    expect(metadataValue(args, 'title')).toBe('Track One')
    expect(metadataValue(args, 'artist')).toBe('The Artist')
    expect(metadataValue(args, 'album')).toBe('The Album')
    expect(metadataValue(args, 'albumartist')).toBe('The Artist')
    expect(metadataValue(args, 'track')).toBe('1/10')
    expect(metadataValue(args, 'date')).toBe('1999')
  })

  it('omits the disc tag for single-disc albums', () => {
    const args = buildFlacEncodeArgs(baseCtx({ totalDiscs: 1 }))
    expect(metadataValue(args, 'disc')).toBeUndefined()
  })

  it('includes the disc tag for multi-disc albums', () => {
    const args = buildFlacEncodeArgs(baseCtx({ totalDiscs: 2, discNumber: 2 }))
    expect(metadataValue(args, 'disc')).toBe('2/2')
  })

  it('does not embed cover art or map a second input when coverArtPath is null', () => {
    const args = buildFlacEncodeArgs(baseCtx({ coverArtPath: null }))
    expect(args).not.toContain('-disposition:v')
    expect(args.filter(a => a === '-i')).toHaveLength(1)
  })

  it('embeds cover art as an attached picture when coverArtPath is set', () => {
    const args = buildFlacEncodeArgs(baseCtx({ coverArtPath: '/tmp/cover.jpg' }))
    expect(args).toEqual(expect.arrayContaining(['-map', '0:a', '-map', '1:v', '-disposition:v', 'attached_pic']))
    expect(args.filter(a => a === '-i')).toHaveLength(2)
  })

  it('tags all four MusicBrainz identifiers when present', () => {
    const args = buildFlacEncodeArgs(baseCtx({
      mbReleaseId: 'release-mbid', albumArtistId: 'artist-mbid',
      recordingId: 'recording-mbid', discId: 'disc-mbid'
    }))
    expect(metadataValue(args, 'MUSICBRAINZ_ALBUMID')).toBe('release-mbid')
    expect(metadataValue(args, 'MUSICBRAINZ_ALBUMARTISTID')).toBe('artist-mbid')
    expect(metadataValue(args, 'MUSICBRAINZ_TRACKID')).toBe('recording-mbid')
    expect(metadataValue(args, 'MUSICBRAINZ_DISCID')).toBe('disc-mbid')
  })

  it('omits MusicBrainz identifier tags entirely when not provided (no empty-string tags)', () => {
    const args = buildFlacEncodeArgs(baseCtx())
    expect(metadataValue(args, 'MUSICBRAINZ_ALBUMID')).toBeUndefined()
    expect(metadataValue(args, 'MUSICBRAINZ_ALBUMARTISTID')).toBeUndefined()
    expect(metadataValue(args, 'MUSICBRAINZ_TRACKID')).toBeUndefined()
    expect(metadataValue(args, 'MUSICBRAINZ_DISCID')).toBeUndefined()
  })

  it('tags genre when present, omits it when absent', () => {
    expect(metadataValue(buildFlacEncodeArgs(baseCtx({ genre: 'grunge' })), 'GENRE')).toBe('grunge')
    expect(metadataValue(buildFlacEncodeArgs(baseCtx({ genre: null })), 'GENRE')).toBeUndefined()
  })

  it('tags COMPILATION=1 only for Various Artists releases', () => {
    const vaArgs = buildFlacEncodeArgs(baseCtx({ isVariousArtists: true }))
    expect(metadataValue(vaArgs, 'COMPILATION')).toBe('1')

    const normalArgs = buildFlacEncodeArgs(baseCtx({ isVariousArtists: false }))
    expect(metadataValue(normalArgs, 'COMPILATION')).toBeUndefined()
  })

  it('always ends with the output path as the final positional argument', () => {
    const args = buildFlacEncodeArgs(baseCtx({ outputPath: '/tmp/final.flac' }))
    expect(args[args.length - 1]).toBe('/tmp/final.flac')
  })
})
