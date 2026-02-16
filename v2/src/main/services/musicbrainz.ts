import { net } from 'electron'
import { createWriteStream, mkdirSync } from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'
import { createLogger } from '../util/logger'

const log = createLogger('musicbrainz')

const MB_BASE = 'https://musicbrainz.org/ws/2'
const COVER_ART_BASE = 'https://coverartarchive.org'
const USER_AGENT = 'ZacTheRipper/2.0.0 (https://github.com/zachalberd/zac-the-ripper)'

export interface MBTrack {
  number: number
  title: string
  artist: string
  durationMs: number
}

export interface MusicBrainzRelease {
  id: string
  title: string
  artist: string
  albumArtist: string
  year: string
  discNumber: number
  totalDiscs: number
  tracks: MBTrack[]
  isVariousArtists: boolean
  coverArtUrl: string | null
}

// Rate limiter: MusicBrainz requires max 1 request/sec
let lastRequestTime = 0
async function rateLimitWait(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < 1100) {
    await new Promise(resolve => setTimeout(resolve, 1100 - elapsed))
  }
  lastRequestTime = Date.now()
}

export class MusicBrainzService {
  private async fetchJson(url: string): Promise<unknown> {
    await rateLimitWait()
    return new Promise((resolve, reject) => {
      const request = net.request({
        url,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
      })
      let body = ''

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          response.on('data', (chunk) => { body += chunk.toString() })
          response.on('end', () => {
            reject(new Error(`MusicBrainz API returned ${response.statusCode}: ${body.slice(0, 200)}`))
          })
          return
        }
        response.on('data', (chunk) => { body += chunk.toString() })
        response.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch {
            reject(new Error('Invalid JSON from MusicBrainz'))
          }
        })
      })

      request.on('error', reject)
      request.end()
    })
  }

  /**
   * Calculate MusicBrainz disc ID from CD TOC.
   * Spec: https://musicbrainz.org/doc/Disc_ID_Calculation
   *
   * SHA-1 of: first_track (2 hex chars) + last_track (2 hex chars) +
   *           lead-out offset (8 hex chars) + 99 track offsets (8 hex chars each)
   * Then base64url encode (replace + with . and / with _ and = with -)
   */
  calculateDiscId(trackOffsets: number[], leadOutSector: number): string {
    const firstTrack = 1
    const lastTrack = trackOffsets.length

    // Build the hash input: all values as uppercase hex, zero-padded
    let hashInput = ''
    hashInput += firstTrack.toString(16).toUpperCase().padStart(2, '0')
    hashInput += lastTrack.toString(16).toUpperCase().padStart(2, '0')
    hashInput += leadOutSector.toString(16).toUpperCase().padStart(8, '0')

    // 99 track offset slots (1-indexed, unused slots are 0)
    for (let i = 0; i < 99; i++) {
      if (i < trackOffsets.length) {
        hashInput += trackOffsets[i].toString(16).toUpperCase().padStart(8, '0')
      } else {
        hashInput += '00000000'
      }
    }

    const sha1 = createHash('sha1').update(hashInput, 'ascii').digest('base64')
    // MusicBrainz base64 variant: + → . , / → _ , = → -
    const discId = sha1.replace(/\+/g, '.').replace(/\//g, '_').replace(/=/g, '-')

    log.info(`calculateDiscId: ${lastTrack} tracks, leadOut=${leadOutSector} → ${discId}`)
    return discId
  }

  async lookupByDiscId(discId: string): Promise<MusicBrainzRelease | null> {
    const url = `${MB_BASE}/discid/${discId}?fmt=json&inc=artist-credits+recordings`
    log.info(`lookupByDiscId: ${discId}`)

    try {
      const data = await this.fetchJson(url) as {
        releases?: Array<{
          id: string
          title: string
          date?: string
          'artist-credit'?: Array<{ name: string; artist: { name: string } }>
          media?: Array<{
            position: number
            'disc-count'?: number
            tracks?: Array<{
              number: string
              title: string
              length: number
              'artist-credit'?: Array<{ name: string; artist: { name: string } }>
              recording?: { title: string; 'artist-credit'?: Array<{ name: string }> }
            }>
          }>
        }>
      }

      if (!data.releases || data.releases.length === 0) {
        log.info(`lookupByDiscId: no releases found for ${discId}`)
        return null
      }

      // Use the first release
      const release = data.releases[0]
      const artistCredits = release['artist-credit'] || []
      const albumArtist = artistCredits.map(ac => ac.name).join('') || 'Unknown Artist'
      const year = (release.date || '').split('-')[0] || ''

      // Find the matching medium (disc)
      const media = release.media || []
      const medium = media[0] // Usually the matched disc is first
      const discNumber = medium?.position || 1
      const totalDiscs = media.length || 1

      // Parse tracks
      const rawTracks = medium?.tracks || []
      const tracks: MBTrack[] = rawTracks.map((t, i) => {
        const trackArtist = t['artist-credit']?.map(ac => ac.name).join('')
          || t.recording?.['artist-credit']?.map(ac => ac.name).join('')
          || albumArtist
        return {
          number: parseInt(t.number) || (i + 1),
          title: t.title || t.recording?.title || `Track ${i + 1}`,
          artist: trackArtist,
          durationMs: t.length || 0
        }
      })

      // Detect Various Artists: check if any track artist differs from album artist
      const uniqueArtists = new Set(tracks.map(t => t.artist))
      const isVariousArtists = uniqueArtists.size > 1 && albumArtist === 'Various Artists'

      const result: MusicBrainzRelease = {
        id: release.id,
        title: release.title || 'Unknown Album',
        artist: isVariousArtists ? 'Various Artists' : albumArtist,
        albumArtist: isVariousArtists ? 'Various Artists' : albumArtist,
        year,
        discNumber,
        totalDiscs,
        tracks,
        isVariousArtists,
        coverArtUrl: `${COVER_ART_BASE}/release/${release.id}/front-500`
      }

      log.info(`lookupByDiscId: found "${result.title}" by ${result.artist} (${result.year}) — ${tracks.length} tracks`)
      return result
    } catch (err) {
      log.warn(`lookupByDiscId failed: ${err}`)
      return null
    }
  }

  async search(query: string): Promise<MusicBrainzRelease[]> {
    const url = `${MB_BASE}/release/?query=${encodeURIComponent(query)}&fmt=json&limit=10`
    log.info(`search: "${query}"`)

    try {
      const data = await this.fetchJson(url) as {
        releases?: Array<{
          id: string
          title: string
          date?: string
          'artist-credit'?: Array<{ name: string }>
          media?: Array<{ position: number; 'track-count': number }>
        }>
      }

      return (data.releases || []).map(r => {
        const artist = r['artist-credit']?.map(ac => ac.name).join('') || 'Unknown Artist'
        const year = (r.date || '').split('-')[0] || ''
        const medium = r.media?.[0]
        return {
          id: r.id,
          title: r.title || 'Unknown',
          artist,
          albumArtist: artist,
          year,
          discNumber: medium?.position || 1,
          totalDiscs: r.media?.length || 1,
          tracks: [],
          isVariousArtists: artist === 'Various Artists',
          coverArtUrl: `${COVER_ART_BASE}/release/${r.id}/front-500`
        }
      })
    } catch (err) {
      log.error(`search failed: ${err}`)
      return []
    }
  }

  async downloadCoverArt(releaseId: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    const url = `${COVER_ART_BASE}/release/${releaseId}/front-500`
    log.info(`downloadCoverArt: ${releaseId} → ${destPath}`)

    try {
      mkdirSync(dirname(destPath), { recursive: true })

      return new Promise((resolve) => {
        const request = net.request({
          url,
          headers: { 'User-Agent': USER_AGENT },
          redirect: 'follow'
        })
        const file = createWriteStream(destPath)

        request.on('response', (response) => {
          if (response.statusCode === 307 || response.statusCode === 302) {
            const location = response.headers['location']
            if (location) {
              file.end()
              // Follow redirect manually
              const redirectUrl = Array.isArray(location) ? location[0] : location
              this.downloadFromUrl(redirectUrl, destPath).then(resolve)
              return
            }
          }
          if (response.statusCode !== 200) {
            file.end()
            resolve({ success: false, error: `HTTP ${response.statusCode}` })
            return
          }
          response.on('data', (chunk) => file.write(chunk))
          response.on('end', () => {
            file.end()
            log.info(`downloadCoverArt: saved to ${destPath}`)
            resolve({ success: true })
          })
        })

        request.on('error', (err) => {
          file.end()
          resolve({ success: false, error: err.message })
        })

        request.end()
      })
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  private async downloadFromUrl(url: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const request = net.request({
        url,
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow'
      })
      const file = createWriteStream(destPath)

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          file.end()
          resolve({ success: false, error: `HTTP ${response.statusCode}` })
          return
        }
        response.on('data', (chunk) => file.write(chunk))
        response.on('end', () => {
          file.end()
          resolve({ success: true })
        })
      })

      request.on('error', (err) => {
        file.end()
        resolve({ success: false, error: err.message })
      })

      request.end()
    })
  }
}
