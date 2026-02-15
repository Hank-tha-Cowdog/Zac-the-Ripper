import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, extname, basename } from 'path'
import { createLogger } from '../util/logger'

const log = createLogger('library-scanner')

// ─── Types ─────────────────────────────────────────────────────────────

export interface LibraryMovie {
  folderName: string
  folderPath: string
  title: string
  year: number | null
  tmdbId: number | null
  imdbId: string | null
  setName: string | null
  setOverview: string | null
  editions: LibraryEdition[]
  hasExtras: boolean
  artwork: {
    hasPoster: boolean
    hasFanart: boolean
  }
}

export interface LibraryEdition {
  fileName: string
  edition: string | null
  filePath: string
  fileSize: number
  nfoPath: string | null
}

export interface LibraryCollection {
  name: string
  movies: LibraryMovie[]
}

export interface LibraryScanResult {
  collections: LibraryCollection[]
  standaloneMovies: LibraryMovie[]
  totalMovies: number
}

// ─── Scanner ───────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.ts', '.m2ts'])

export function scanLibrary(libraryPath: string): LibraryScanResult {
  const moviesDir = join(libraryPath, 'Movies')
  if (!existsSync(moviesDir)) {
    return { collections: [], standaloneMovies: [], totalMovies: 0 }
  }

  const movies: LibraryMovie[] = []

  try {
    const entries = readdirSync(moviesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue

      const folderPath = join(moviesDir, entry.name)
      const movie = scanMovieFolder(entry.name, folderPath)
      if (movie) movies.push(movie)
    }
  } catch (err) {
    log.error(`Failed to scan library: ${err}`)
  }

  // Group by collection/set name
  const collectionMap = new Map<string, LibraryMovie[]>()
  const standaloneMovies: LibraryMovie[] = []

  for (const movie of movies) {
    if (movie.setName) {
      const existing = collectionMap.get(movie.setName) || []
      existing.push(movie)
      collectionMap.set(movie.setName, existing)
    } else {
      standaloneMovies.push(movie)
    }
  }

  const collections: LibraryCollection[] = Array.from(collectionMap.entries())
    .map(([name, movies]) => ({ name, movies: movies.sort(sortByYear) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  standaloneMovies.sort((a, b) => a.title.localeCompare(b.title))

  return {
    collections,
    standaloneMovies,
    totalMovies: movies.length
  }
}

export function scanMovieFolder(folderName: string, folderPath: string): LibraryMovie | null {
  // Parse "Title (Year)" from folder name
  const match = folderName.match(/^(.+?)\s*\((\d{4})\)$/)
  const title = match ? match[1].trim() : folderName
  const year = match ? parseInt(match[2]) : null

  try {
    const files = readdirSync(folderPath)

    // Find video files (skip Extras/ subfolder contents)
    const editions: LibraryEdition[] = []
    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!VIDEO_EXTENSIONS.has(ext)) continue

      const filePath = join(folderPath, file)
      const stat = statSync(filePath)
      if (!stat.isFile()) continue

      // Parse edition from filename: "Title (Year) - Director's Cut.mkv"
      const fileBase = basename(file, ext)
      let edition: string | null = null
      const editionMatch = fileBase.match(/\s-\s(.+)$/)
      if (editionMatch) {
        edition = editionMatch[1]
      }

      // Look for matching NFO
      const nfoPath = join(folderPath, `${fileBase}.nfo`)
      const hasNfo = existsSync(nfoPath)

      editions.push({
        fileName: file,
        edition,
        filePath,
        fileSize: stat.size,
        nfoPath: hasNfo ? nfoPath : null
      })
    }

    if (editions.length === 0) return null

    // Check for extras category folders (Plex/Jellyfin convention)
    const extrasFolders = ['Featurettes', 'Behind The Scenes', 'Deleted Scenes', 'Interviews', 'Scenes', 'Shorts', 'Trailers', 'Other']
    const hasExtras = extrasFolders.some(f => existsSync(join(folderPath, f)))

    // Check for artwork
    const hasPoster = existsSync(join(folderPath, 'poster.jpg'))
    const hasFanart = existsSync(join(folderPath, 'fanart.jpg'))

    // Parse metadata from NFO files (set/collection, TMDB/IMDB IDs)
    let setName: string | null = null
    let setOverview: string | null = null
    let tmdbId: number | null = null
    let imdbId: string | null = null
    for (const edition of editions) {
      if (edition.nfoPath) {
        const nfoData = parseNFOInfo(edition.nfoPath)
        if (nfoData.setName && !setName) {
          setName = nfoData.setName
          setOverview = nfoData.setOverview
        }
        if (nfoData.tmdbId && !tmdbId) tmdbId = nfoData.tmdbId
        if (nfoData.imdbId && !imdbId) imdbId = nfoData.imdbId
        if (setName && tmdbId && imdbId) break
      }
    }

    return {
      folderName,
      folderPath,
      title,
      year,
      tmdbId,
      imdbId,
      setName,
      setOverview,
      editions,
      hasExtras,
      artwork: { hasPoster, hasFanart }
    }
  } catch (err) {
    log.warn(`Failed to scan movie folder ${folderName}: ${err}`)
    return null
  }
}

interface NFOParsedInfo {
  setName: string | null
  setOverview: string | null
  tmdbId: number | null
  imdbId: string | null
}

function parseNFOInfo(nfoPath: string): NFOParsedInfo {
  const empty: NFOParsedInfo = { setName: null, setOverview: null, tmdbId: null, imdbId: null }
  try {
    const content = readFileSync(nfoPath, 'utf-8')

    let setName: string | null = null
    let setOverview: string | null = null
    let tmdbId: number | null = null
    let imdbId: string | null = null

    // Parse <set><name>...</name></set>
    const setMatch = content.match(/<set>\s*<name>(.*?)<\/name>(?:\s*<overview>(.*?)<\/overview>)?\s*<\/set>/s)
    if (setMatch) {
      setName = unescapeXml(setMatch[1].trim())
      setOverview = setMatch[2] ? unescapeXml(setMatch[2].trim()) : null
    }

    // Parse <uniqueid type="tmdb">123</uniqueid>
    const tmdbMatch = content.match(/<uniqueid\s+type="tmdb"[^>]*>(.*?)<\/uniqueid>/)
    if (tmdbMatch) {
      const parsed = parseInt(tmdbMatch[1].trim())
      if (!isNaN(parsed)) tmdbId = parsed
    }

    // Parse <uniqueid type="imdb">tt0046672</uniqueid>
    const imdbMatch = content.match(/<uniqueid\s+type="imdb"[^>]*>(.*?)<\/uniqueid>/)
    if (imdbMatch) {
      imdbId = imdbMatch[1].trim() || null
    }

    return { setName, setOverview, tmdbId, imdbId }
  } catch {
    return empty
  }
}

function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function sortByYear(a: LibraryMovie, b: LibraryMovie): number {
  return (a.year || 0) - (b.year || 0)
}
