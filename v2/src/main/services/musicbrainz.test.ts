import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

interface FakeRequest extends EventEmitter {
  end: () => void
}

let nextResponses: Array<{ statusCode: number; body: string }> = []
const requestedUrls: string[] = []

vi.mock('electron', () => ({
  net: {
    request: vi.fn((opts: { url: string }) => {
      requestedUrls.push(opts.url)
      const req = new EventEmitter() as FakeRequest
      req.end = () => {
        const next = nextResponses.shift()
        if (!next) throw new Error('musicbrainz.test.ts: no mocked response queued')
        queueMicrotask(() => {
          const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
          res.statusCode = next.statusCode
          res.headers = {}
          req.emit('response', res)
          queueMicrotask(() => {
            res.emit('data', Buffer.from(next.body))
            res.emit('end')
          })
        })
      }
      return req
    })
  }
}))

import { MusicBrainzService, _resetRateLimitForTesting } from './musicbrainz'

function queueResponse(statusCode: number, body: unknown): void {
  nextResponses.push({ statusCode, body: JSON.stringify(body) })
}

beforeEach(() => {
  nextResponses = []
  requestedUrls.length = 0
  _resetRateLimitForTesting()
})

describe('calculateDiscId', () => {
  it('matches the official MusicBrainz spec worked example exactly', () => {
    // From https://musicbrainz.org/doc/Disc_ID_Calculation's own audio CD
    // example — independently re-verified outside this test suite (plain
    // node + crypto) before being encoded here as a golden fixture.
    const service = new MusicBrainzService()
    const trackOffsets = [150, 15363, 32314, 46592, 63414, 80489]
    const leadOutSector = 95462
    expect(service.calculateDiscId(trackOffsets, leadOutSector)).toBe('49HHV7Eb8UKF3aQiNmu1GR8vKTY-')
  })

  it('produces a different id when the +150 offset is missing (regression guard)', () => {
    // Same track, but as RAW (unshifted) cdparanoia offsets — must NOT
    // collide with the correctly-shifted id above.
    const service = new MusicBrainzService()
    const rawOffsets = [0, 15213, 32164, 46442, 63264, 80339]
    const rawLeadOut = 95312
    const result = service.calculateDiscId(rawOffsets, rawLeadOut)
    expect(result).not.toBe('49HHV7Eb8UKF3aQiNmu1GR8vKTY-')
  })
})

describe('lookupByDiscIdAll — disambiguation', () => {
  it('returns every candidate release instead of only the first', async () => {
    queueResponse(200, {
      releases: [
        { id: 'release-us', title: 'Album (US)', date: '1999-01-01', 'artist-credit': [{ name: 'Artist', artist: { name: 'Artist' } }], media: [{ position: 1, tracks: [] }] },
        { id: 'release-uk', title: 'Album (UK)', date: '1999-03-01', 'artist-credit': [{ name: 'Artist', artist: { name: 'Artist' } }], media: [{ position: 1, tracks: [] }] }
      ]
    })
    const service = new MusicBrainzService()
    const results = await service.lookupByDiscIdAll('someDiscId')
    expect(results).toHaveLength(2)
    expect(results.map(r => r.id)).toEqual(['release-us', 'release-uk'])
  })

  it('returns an empty array (not null/throw) when no releases match', async () => {
    queueResponse(200, {})
    const service = new MusicBrainzService()
    expect(await service.lookupByDiscIdAll('unknownDiscId')).toEqual([])
  })

  it('lookupByDiscId returns just the first candidate for backward compatibility', async () => {
    queueResponse(200, {
      releases: [
        { id: 'release-a', title: 'A', 'artist-credit': [{ name: 'X', artist: { name: 'X' } }], media: [{ position: 1, tracks: [] }] },
        { id: 'release-b', title: 'B', 'artist-credit': [{ name: 'X', artist: { name: 'X' } }], media: [{ position: 1, tracks: [] }] }
      ]
    })
    const service = new MusicBrainzService()
    const result = await service.lookupByDiscId('someDiscId')
    expect(result?.id).toBe('release-a')
  })
})

describe('lookupById — full track fetch for manual selection', () => {
  it('fetches the complete track list by release id', async () => {
    queueResponse(200, {
      id: 'release-xyz',
      title: 'Full Album',
      date: '2005-06-15',
      'artist-credit': [{ name: 'Band', artist: { name: 'Band' } }],
      media: [{
        position: 1,
        tracks: [
          { number: '1', title: 'Intro', length: 60000 },
          { number: '2', title: 'Main Track', length: 240000 }
        ]
      }]
    })
    const service = new MusicBrainzService()
    const result = await service.lookupById('release-xyz')
    expect(result?.tracks).toHaveLength(2)
    expect(result?.tracks[1]).toMatchObject({ number: 2, title: 'Main Track', durationMs: 240000 })
  })

  it('requests the release endpoint directly, not the search endpoint', async () => {
    queueResponse(200, { id: 'r1', title: 'T', media: [] })
    const service = new MusicBrainzService()
    await service.lookupById('r1')
    expect(requestedUrls[0]).toContain('/release/r1')
  })

  it('returns null when the release id does not exist', async () => {
    queueResponse(200, {})
    const service = new MusicBrainzService()
    expect(await service.lookupById('nonexistent')).toBeNull()
  })

  it('returns null (not a throw) on a non-200 response', async () => {
    queueResponse(404, { error: 'Not Found' })
    const service = new MusicBrainzService()
    expect(await service.lookupById('missing')).toBeNull()
  })
})

describe('MBID and genre extraction (Vorbis tagging support)', () => {
  it('extracts the recording MBID per track from recording.id', async () => {
    // Shape verified against a real MusicBrainz API response (release
    // f922ec87-4758-421d-a839-3193455345ff, Nirvana - Nevermind).
    queueResponse(200, {
      id: 'release-1',
      title: 'Album',
      'artist-credit': [{ name: 'Artist', artist: { id: 'artist-mbid-1', name: 'Artist' } }],
      media: [{
        position: 1,
        tracks: [
          { number: '1', title: 'Track One', length: 180000, recording: { id: 'recording-mbid-1', title: 'Track One' } }
        ]
      }]
    })
    const service = new MusicBrainzService()
    const result = await service.lookupById('release-1')
    expect(result?.tracks[0].recordingId).toBe('recording-mbid-1')
  })

  it('defaults recordingId to an empty string when the API omits it, rather than undefined', async () => {
    queueResponse(200, {
      id: 'release-1',
      title: 'Album',
      media: [{ position: 1, tracks: [{ number: '1', title: 'Track One', length: 180000 }] }]
    })
    const service = new MusicBrainzService()
    const result = await service.lookupById('release-1')
    expect(result?.tracks[0].recordingId).toBe('')
  })

  it('extracts the primary album artist MBID', async () => {
    queueResponse(200, {
      id: 'release-1',
      title: 'Album',
      'artist-credit': [{ name: 'Artist', artist: { id: 'artist-mbid-1', name: 'Artist' } }],
      media: [{ position: 1, tracks: [] }]
    })
    const service = new MusicBrainzService()
    const result = await service.lookupById('release-1')
    expect(result?.albumArtistId).toBe('artist-mbid-1')
  })

  it('leaves albumArtistId null for Various Artists releases (no single artist MBID applies)', async () => {
    queueResponse(200, {
      id: 'va-release',
      title: 'Compilation',
      'artist-credit': [{ name: 'Various Artists', artist: { id: 'va-mbid', name: 'Various Artists' } }],
      media: [{
        position: 1,
        tracks: [
          { number: '1', title: 'A', length: 1000, 'artist-credit': [{ name: 'Artist A', artist: { name: 'Artist A' } }] },
          { number: '2', title: 'B', length: 1000, 'artist-credit': [{ name: 'Artist B', artist: { name: 'Artist B' } }] }
        ]
      }]
    })
    const service = new MusicBrainzService()
    const result = await service.lookupById('va-release')
    expect(result?.isVariousArtists).toBe(true)
    expect(result?.albumArtistId).toBeNull()
  })

  it('picks the highest-vote-count release-level genre', async () => {
    queueResponse(200, {
      id: 'release-1',
      title: 'Album',
      genres: [
        { name: 'pop', count: 3 },
        { name: 'grunge', count: 64 },
        { name: 'rock', count: 23 }
      ],
      media: [{ position: 1, tracks: [] }]
    })
    const service = new MusicBrainzService()
    const result = await service.lookupById('release-1')
    expect(result?.genre).toBe('grunge')
  })

  it('falls back to the primary artist genres when release-level genres are empty', async () => {
    // Real observed case: release.genres is [] but artist-credit[0].artist.genres is populated.
    queueResponse(200, {
      id: 'release-1',
      title: 'Album',
      genres: [],
      'artist-credit': [{
        name: 'Nirvana',
        artist: {
          id: 'artist-1', name: 'Nirvana',
          genres: [{ name: 'grunge', count: 64 }, { name: 'punk rock', count: 1 }]
        }
      }],
      media: [{ position: 1, tracks: [] }]
    })
    const service = new MusicBrainzService()
    const result = await service.lookupById('release-1')
    expect(result?.genre).toBe('grunge')
  })

  it('returns null genre when neither release nor artist has any genre data', async () => {
    queueResponse(200, { id: 'release-1', title: 'Album', media: [{ position: 1, tracks: [] }] })
    const service = new MusicBrainzService()
    const result = await service.lookupById('release-1')
    expect(result?.genre).toBeNull()
  })
})

describe('Various Artists detection', () => {
  it('flags a release as Various Artists only when album artist says so AND tracks disagree', async () => {
    queueResponse(200, {
      id: 'va-release',
      title: 'Compilation',
      'artist-credit': [{ name: 'Various Artists', artist: { name: 'Various Artists' } }],
      media: [{
        position: 1,
        tracks: [
          { number: '1', title: 'Song A', length: 1000, 'artist-credit': [{ name: 'Artist A', artist: { name: 'Artist A' } }] },
          { number: '2', title: 'Song B', length: 1000, 'artist-credit': [{ name: 'Artist B', artist: { name: 'Artist B' } }] }
        ]
      }]
    })
    const service = new MusicBrainzService()
    const result = await service.lookupById('va-release')
    expect(result?.isVariousArtists).toBe(true)
    expect(result?.tracks[0].artist).toBe('Artist A')
    expect(result?.tracks[1].artist).toBe('Artist B')
  })
})
