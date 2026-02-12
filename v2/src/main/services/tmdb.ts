import { net } from 'electron'
import { createWriteStream, mkdirSync } from 'fs'
import { dirname } from 'path'
import { getSetting } from '../database/queries/settings'
import { createLogger } from '../util/logger'

const log = createLogger('tmdb')

const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export interface TMDBSearchResult {
  id: number
  title: string
  name?: string
  original_title?: string
  release_date?: string
  first_air_date?: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  media_type?: string
}

export interface TMDBDetails {
  id: number
  title: string
  original_title: string
  release_date: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  genres: Array<{ id: number; name: string }>
  runtime: number
  vote_average: number
  imdb_id: string | null
  tagline: string
  belongs_to_collection: {
    id: number
    name: string
    poster_path: string | null
    backdrop_path: string | null
  } | null
}

export class TMDBService {
  private getApiKey(): string {
    return getSetting('kodi.tmdb_api_key') || ''
  }

  private async fetchJson(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = net.request(url)
      let body = ''

      request.on('response', (response) => {
        response.on('data', (chunk) => { body += chunk.toString() })
        response.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch (e) {
            reject(new Error('Invalid JSON response'))
          }
        })
      })

      request.on('error', reject)
      request.end()
    })
  }

  async search(query: string, type?: string): Promise<TMDBSearchResult[]> {
    const apiKey = this.getApiKey()
    if (!apiKey) {
      log.warn('TMDB search skipped — no API key configured (set kodi.tmdb_api_key in Settings)')
      return []
    }

    const mediaType = type === 'tvshow' ? 'tv' : type === 'movie' ? 'movie' : 'multi'
    const endpoint = mediaType === 'multi' ? 'search/multi' : `search/${mediaType}`
    const url = `${TMDB_BASE}/${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(query)}`

    try {
      const data = await this.fetchJson(url) as { results?: TMDBSearchResult[] }
      return (data.results || []).map(r => ({
        ...r,
        title: r.title || r.name || 'Unknown'
      }))
    } catch (err) {
      log.error(`TMDB search failed: ${err}`)
      return []
    }
  }

  async getDetails(id: number, type: string): Promise<TMDBDetails | null> {
    const apiKey = this.getApiKey()
    if (!apiKey) {
      log.warn('TMDB getDetails skipped — no API key configured')
      return null
    }

    const mediaType = type === 'tvshow' ? 'tv' : 'movie'
    const url = `${TMDB_BASE}/${mediaType}/${id}?api_key=${apiKey}&append_to_response=external_ids`

    try {
      const data = await this.fetchJson(url) as TMDBDetails & { external_ids?: { imdb_id: string } }
      return {
        ...data,
        title: data.title || (data as unknown as { name: string }).name || 'Unknown',
        imdb_id: data.imdb_id || data.external_ids?.imdb_id || null
      }
    } catch (err) {
      log.error(`TMDB details failed: ${err}`)
      return null
    }
  }

  async downloadArtwork(imagePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (!imagePath) return { success: false, error: 'No image path' }

    const url = `${TMDB_IMAGE_BASE}/original${imagePath}`

    try {
      mkdirSync(dirname(destPath), { recursive: true })

      return new Promise((resolve) => {
        const request = net.request(url)
        const file = createWriteStream(destPath)

        request.on('response', (response) => {
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
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }
}
