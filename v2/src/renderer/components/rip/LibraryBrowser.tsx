import React, { useState, useEffect, useMemo } from 'react'
import { Search, FolderOpen, Film, Layers, ChevronRight, HardDrive, Image, FileText } from 'lucide-react'
import { Modal, Input, Button, Badge, TechLabel } from '../ui'

// ─── Types (mirrors library-scanner.ts) ─────────────────────────────

interface LibraryEdition {
  fileName: string
  edition: string | null
  filePath: string
  fileSize: number
  nfoPath: string | null
}

interface LibraryMovie {
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

interface LibraryCollection {
  name: string
  movies: LibraryMovie[]
}

interface LibraryScanResult {
  collections: LibraryCollection[]
  standaloneMovies: LibraryMovie[]
  totalMovies: number
}

// ─── Props ──────────────────────────────────────────────────────────

export interface LibrarySelection {
  movie: LibraryMovie
  setName: string | null
  setOverview: string | null
}

interface LibraryBrowserProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (selection: LibrarySelection) => void
}

// ─── Component ──────────────────────────────────────────────────────

export function LibraryBrowser({ isOpen, onClose, onSelect }: LibraryBrowserProps) {
  const [scanResult, setScanResult] = useState<LibraryScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCollection, setExpandedCollection] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadLibrary()
    }
  }, [isOpen])

  const loadLibrary = async () => {
    setLoading(true)
    try {
      const result = await window.ztr.library.scan()
      setScanResult(result)
    } catch (err) {
      console.error('Library scan failed:', err)
    } finally {
      setLoading(false)
    }
  }

  // Filter movies and collections by search query
  const filtered = useMemo(() => {
    if (!scanResult) return { collections: [], standaloneMovies: [] }
    const q = searchQuery.toLowerCase().trim()
    if (!q) return scanResult

    const collections = scanResult.collections
      .map(c => ({
        ...c,
        movies: c.movies.filter(m =>
          m.title.toLowerCase().includes(q) ||
          m.folderName.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q)
        )
      }))
      .filter(c => c.movies.length > 0)

    const standaloneMovies = scanResult.standaloneMovies.filter(m =>
      m.title.toLowerCase().includes(q) ||
      m.folderName.toLowerCase().includes(q)
    )

    return { collections, standaloneMovies }
  }, [scanResult, searchQuery])

  const handleSelectMovie = (movie: LibraryMovie, setName?: string | null, setOverview?: string | null) => {
    onSelect({
      movie,
      setName: setName ?? movie.setName,
      setOverview: setOverview ?? movie.setOverview
    })
    onClose()
  }

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add to Existing Movie" maxWidth="max-w-3xl">
      {/* Search */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            className="input w-full pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search movies or collections..."
            autoFocus
          />
        </div>
        <Button variant="secondary" onClick={loadLibrary} disabled={loading}>
          {loading ? 'Scanning...' : 'Refresh'}
        </Button>
      </div>

      {/* Results */}
      <div className="max-h-[28rem] overflow-y-auto scrollbar-thin space-y-1">
        {loading && (
          <div className="text-center py-12 text-zinc-500 text-sm">
            Scanning library...
          </div>
        )}

        {!loading && scanResult && scanResult.totalMovies === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-zinc-500">No movies found in library.</p>
            <p className="text-xs text-zinc-600 mt-1">
              Set your Kodi library path in Settings &gt; Kodi, then export some movies first.
            </p>
          </div>
        )}

        {/* Collections */}
        {filtered.collections.map((collection) => (
          <div key={collection.name} className="rounded-lg border border-zinc-800 overflow-hidden">
            <button
              className="w-full flex items-center gap-3 p-3 hover:bg-zinc-800/50 transition-colors text-left"
              onClick={() => setExpandedCollection(
                expandedCollection === collection.name ? null : collection.name
              )}
            >
              <Layers className="w-4 h-4 text-purple-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-zinc-100">{collection.name}</span>
                <span className="text-xs text-zinc-500 ml-2">
                  {collection.movies.length} movie{collection.movies.length !== 1 ? 's' : ''}
                </span>
              </div>
              <ChevronRight className={`w-4 h-4 text-zinc-500 transition-transform ${
                expandedCollection === collection.name ? 'rotate-90' : ''
              }`} />
            </button>

            {expandedCollection === collection.name && (
              <div className="border-t border-zinc-800">
                {collection.movies.map((movie) => (
                  <MovieRow
                    key={movie.folderPath}
                    movie={movie}
                    indent
                    formatSize={formatSize}
                    onSelect={() => handleSelectMovie(movie, collection.name, collection.movies[0]?.setOverview)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Standalone movies */}
        {filtered.standaloneMovies.map((movie) => (
          <MovieRow
            key={movie.folderPath}
            movie={movie}
            formatSize={formatSize}
            onSelect={() => handleSelectMovie(movie)}
          />
        ))}
      </div>

      {/* Footer */}
      {scanResult && scanResult.totalMovies > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600">
            {scanResult.totalMovies} movie{scanResult.totalMovies !== 1 ? 's' : ''} in library
            {scanResult.collections.length > 0 && ` / ${scanResult.collections.length} collection${scanResult.collections.length !== 1 ? 's' : ''}`}
          </span>
        </div>
      )}
    </Modal>
  )
}

// ─── Movie Row ──────────────────────────────────────────────────────

function MovieRow({ movie, indent, formatSize, onSelect }: {
  movie: LibraryMovie
  indent?: boolean
  formatSize: (bytes: number) => string
  onSelect: () => void
}) {
  return (
    <button
      className={`w-full flex items-start gap-3 p-3 hover:bg-zinc-800/50 cursor-pointer transition-colors text-left ${
        indent ? 'pl-10' : 'rounded-lg border border-zinc-800'
      }`}
      onClick={onSelect}
    >
      <Film className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-100">{movie.title}</span>
          {movie.year && <span className="text-xs text-zinc-500">({movie.year})</span>}
        </div>

        {/* Existing editions/versions */}
        <div className="mt-1 flex flex-wrap gap-1">
          {movie.editions.map((ed) => (
            <span
              key={ed.fileName}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700"
            >
              <HardDrive className="w-2.5 h-2.5" />
              {ed.edition || 'Main'}
              <span className="text-zinc-600">{formatSize(ed.fileSize)}</span>
            </span>
          ))}
          {movie.hasExtras && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
              <FolderOpen className="w-2.5 h-2.5" />
              Extras
            </span>
          )}
        </div>

        {/* Status icons */}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
          {movie.artwork.hasPoster && (
            <span className="flex items-center gap-0.5"><Image className="w-2.5 h-2.5" /> poster</span>
          )}
          {movie.artwork.hasFanart && (
            <span className="flex items-center gap-0.5"><Image className="w-2.5 h-2.5" /> fanart</span>
          )}
          {movie.editions.some(e => e.nfoPath) && (
            <span className="flex items-center gap-0.5"><FileText className="w-2.5 h-2.5" /> nfo</span>
          )}
          {movie.tmdbId && (
            <span className="flex items-center gap-0.5 text-purple-500">TMDB:{movie.tmdbId}</span>
          )}
        </div>
      </div>
    </button>
  )
}
