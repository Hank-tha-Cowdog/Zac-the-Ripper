import React, { useState } from 'react'
import { Search, Film, Tv, Package, FolderOpen, Layers } from 'lucide-react'
import { Card, Input, Select, Button, Modal, TechLabel, Badge, Tooltip, LabelWithTooltip, Toggle } from '../ui'
import { MOVIE_VERSIONS } from '../../../shared/constants'
import { LibraryBrowser, LibrarySelection } from './LibraryBrowser'

interface TMDBResult {
  id: number
  title: string
  release_date?: string
  first_air_date?: string
  overview: string
  poster_path: string | null
  vote_average: number
}

interface KodiOptionsPanelProps {
  mediaType: string
  onMediaTypeChange: (type: string) => void
  title: string
  onTitleChange: (title: string) => void
  year: string
  onYearChange: (year: string) => void
  tmdbId: number | null
  onTmdbSelect: (result: TMDBResult) => void
  edition: string
  onEditionChange: (edition: string) => void
  customEdition: string
  onCustomEditionChange: (value: string) => void
  isExtrasDisc: boolean
  onExtrasDiscChange: (v: boolean) => void
  setName: string
  onSetNameChange: (name: string) => void
  onLibrarySelect: (selection: LibrarySelection) => void
  convertSubsToSrt?: boolean
  onConvertSubsToSrtChange?: (v: boolean) => void
}

export function KodiOptionsPanel({
  mediaType,
  onMediaTypeChange,
  title,
  onTitleChange,
  year,
  onYearChange,
  tmdbId,
  onTmdbSelect,
  edition,
  onEditionChange,
  customEdition,
  onCustomEditionChange,
  isExtrasDisc,
  onExtrasDiscChange,
  setName,
  onSetNameChange,
  onLibrarySelect,
  convertSubsToSrt,
  onConvertSubsToSrtChange
}: KodiOptionsPanelProps) {
  const [showSearch, setShowSearch] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TMDBResult[]>([])
  const [searching, setSearching] = useState(false)

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const results = await window.ztr.tmdb.search(searchQuery, mediaType)
      setSearchResults(results || [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const handleSelect = async (result: TMDBResult) => {
    onTmdbSelect(result)
    onTitleChange(result.title)
    const releaseYear = (result.release_date || result.first_air_date || '').split('-')[0]
    if (releaseYear) onYearChange(releaseYear)
    setShowSearch(false)

    // Fetch full details to get collection/set info
    if (mediaType === 'movie') {
      try {
        const details = await window.ztr.tmdb.getDetails(result.id, 'movie')
        if (details?.belongs_to_collection?.name) {
          onSetNameChange(details.belongs_to_collection.name)
        }
      } catch { /* TMDB details fetch is best-effort */ }
    }
  }

  return (
    <Card className="ml-12 mt-2">
      <TechLabel className="mb-3 block">Kodi Options</TechLabel>

      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <LabelWithTooltip
            label="Media Type"
            tooltip="Movie: creates Movies/Title (Year)/ folder with movie.nfo. TV Show: creates TV Shows/Show Name/Season XX/ with episode NFOs. Determines folder structure and NFO format."
            className="label-tech"
          />
          <div className="relative">
            <select
              className="select w-full pr-8"
              value={mediaType}
              onChange={(e) => onMediaTypeChange(e.target.value)}
            >
              <option value="movie">Movie</option>
              <option value="tvshow">TV Show</option>
            </select>
          </div>
        </div>

        {/* Add to Existing Movie */}
        {mediaType === 'movie' && (
          <Tooltip content="Browse your Kodi library to add a new version, disc, or extras to an existing movie. Matches the existing folder structure and collection grouping.">
            <Button
              variant="secondary"
              size="sm"
              className="w-full text-amber-400 hover:text-amber-300 border-amber-500/30"
              icon={<FolderOpen className="w-3 h-3" />}
              onClick={() => setShowLibrary(true)}
            >
              Add to Existing Movie...
            </Button>
          </Tooltip>
        )}

        <div className="flex gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <LabelWithTooltip
              label="Title"
              tooltip="The movie or show title used for folder naming and NFO metadata. Must match TMDB for best Kodi scraper compatibility. Search TMDB to auto-fill."
              className="label-tech"
            />
            <input
              className="input w-full"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 w-24">
            <LabelWithTooltip
              label="Year"
              tooltip="Release year used in folder name: Title (Year)/. Helps Kodi disambiguate remakes and re-releases."
              className="label-tech"
            />
            <input
              className="input w-full"
              value={year}
              onChange={(e) => onYearChange(e.target.value)}
            />
          </div>
        </div>

        {/* Search TMDB — immediately below title */}
        <div className="flex items-center gap-2">
          <Tooltip content="Search The Movie Database (TMDB) to auto-fill title, year, plot, cast, ratings, poster, and fanart. Requires a TMDB API key in Settings > Kodi.">
            <Button
              variant="secondary"
              size="sm"
              className="text-cyan-400 hover:text-cyan-300 border-cyan-500/30"
              icon={<Search className="w-3 h-3" />}
              onClick={() => {
                setSearchQuery(title)
                setShowSearch(true)
              }}
            >
              Search TMDB
            </Button>
          </Tooltip>
          {tmdbId && (
            <Tooltip content={`Linked to TMDB entry #${tmdbId}. Metadata, artwork, and cast info will be fetched from this entry.`}>
              <Badge variant="success">TMDB #{tmdbId}</Badge>
            </Tooltip>
          )}
        </div>

        {/* Collection / Set Name */}
        {mediaType === 'movie' && (
          <div className="flex flex-col gap-1">
            <LabelWithTooltip
              label="Collection"
              tooltip="Kodi groups movies with the same <set> NFO tag into a collection (e.g., 'Die Hard Collection'). Auto-populated from TMDB or when adding to an existing movie."
              className="label-tech"
            />
            <div className="flex items-center gap-2">
              <input
                className="input flex-1"
                value={setName}
                onChange={(e) => onSetNameChange(e.target.value)}
                placeholder="e.g., Die Hard Collection"
              />
              {setName && (
                <Badge variant="info">
                  <Layers className="w-2.5 h-2.5 mr-1" />
                  Set
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Movie Version / Edition */}
        {mediaType === 'movie' && (
          <div className="flex flex-col gap-1">
            <LabelWithTooltip
              label="Movie Version"
              tooltip="Kodi v21+ uses the <edition> NFO tag to distinguish between different versions of the same movie (Theatrical, Director's Cut, etc.). All versions share the same folder: Title (Year)/."
              className="label-tech"
            />
            <div className="relative">
              <select
                className="select w-full pr-8"
                value={edition}
                onChange={(e) => onEditionChange(e.target.value)}
              >
                <option value="">None (default)</option>
                {MOVIE_VERSIONS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            {edition === 'Custom' && (
              <input
                className="input w-full mt-1"
                placeholder="Enter custom edition name..."
                value={customEdition}
                onChange={(e) => onCustomEditionChange(e.target.value)}
              />
            )}
          </div>
        )}

        {/* Extras Disc toggle */}
        {mediaType === 'movie' && (
          <div className="flex items-center gap-1">
            <Toggle
              checked={isExtrasDisc}
              onChange={onExtrasDiscChange}
              label="Extras Disc"
              description="Route to Extras/ subfolder (bonus features, behind the scenes)"
            />
            <Tooltip
              content="When enabled, files from this disc are placed in the Extras/ subfolder within the movie directory. Kodi displays these as bonus content alongside the main movie."
              inline
              position="right"
            />
          </div>
        )}

        {/* SRT toggle — Kodi-specific framing */}
        {onConvertSubsToSrtChange && convertSubsToSrt !== undefined && (
          <div className="pt-3 border-t border-zinc-800">
            <div className="flex items-center gap-1">
              <Toggle
                checked={convertSubsToSrt}
                onChange={onConvertSubsToSrtChange}
                label="Convert Subtitles to SRT"
                description="OCR image subs to text SRT — needed for players that can't render PGS/VobSub"
              />
              <Tooltip
                content="Kodi handles PGS/VobSub natively. Enable if files may also play on mobile/web players that require text-based subtitles."
                inline
                position="right"
              />
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={showSearch} onClose={() => setShowSearch(false)} title="Search TMDB" maxWidth="max-w-2xl">
        <div className="flex gap-2 mb-4">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search title..."
            className="flex-1"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <Button onClick={handleSearch} disabled={searching}>
            {searching ? 'Searching...' : 'Search'}
          </Button>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
          {searchResults.map((result) => (
            <div
              key={result.id}
              className="flex gap-3 p-3 rounded-lg hover:bg-zinc-800/50 cursor-pointer transition-colors border border-transparent hover:border-purple-500/30"
              onClick={() => handleSelect(result)}
            >
              {result.poster_path && (
                <img
                  src={`https://image.tmdb.org/t/p/w92${result.poster_path}`}
                  alt={result.title}
                  className="w-12 h-18 rounded object-cover"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-100">{result.title}</span>
                  <span className="text-xs text-zinc-500">
                    ({(result.release_date || result.first_air_date || '').split('-')[0]})
                  </span>
                  <Badge variant="default">{result.vote_average.toFixed(1)}</Badge>
                </div>
                <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{result.overview}</p>
              </div>
            </div>
          ))}

          {searchResults.length === 0 && !searching && (
            <div className="text-center text-sm text-zinc-600 py-8">
              No results. Try a different search term.
            </div>
          )}
        </div>
      </Modal>

      <LibraryBrowser
        isOpen={showLibrary}
        onClose={() => setShowLibrary(false)}
        onSelect={(selection) => {
          onLibrarySelect(selection)
          setShowLibrary(false)
        }}
      />
    </Card>
  )
}
