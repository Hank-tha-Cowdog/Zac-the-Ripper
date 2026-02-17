import React, { useState } from 'react'
import { Search, Film, Tv, Package, FolderOpen, Layers, Upload, Plus, X } from 'lucide-react'
import { Card, Input, Select, Button, Modal, TechLabel, Badge, Tooltip, LabelWithTooltip, Toggle } from '../ui'
import { MOVIE_VERSIONS, SOUND_VERSIONS } from '../../../shared/constants'
import { LibraryBrowser, LibrarySelection } from './LibraryBrowser'
import { useAppStore } from '../../stores/app-store'
import { useDiscStore } from '../../stores/disc-store'

// ─── Types ─────────────────────────────────────────────────────

interface TMDBResult {
  id: number
  title: string
  release_date?: string
  first_air_date?: string
  overview: string
  poster_path: string | null
  vote_average: number
}

interface RipConfigPanelProps {
  // Rip modes
  modes: Record<string, boolean>
  onModesChange: (modes: Record<string, boolean>) => void
  convertSubsToSrt: boolean
  onConvertSubsToSrtChange: (v: boolean) => void
  outputPaths: Record<string, string>
  onOutputPathChange: (mode: string, path: string) => void
  // Media options
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
  soundVersion: string
  onSoundVersionChange: (v: string) => void
  customSoundVersion: string
  onCustomSoundVersionChange: (v: string) => void
  discNumber: string
  onDiscNumberChange: (v: string) => void
  totalDiscs: string
  onTotalDiscsChange: (v: string) => void
  // TV show
  tvSeason: string
  onTvSeasonChange: (v: string) => void
  tvStartEpisode: string
  onTvStartEpisodeChange: (v: string) => void
  // Custom metadata
  customPlot: string
  onCustomPlotChange: (v: string) => void
  customActors: string[]
  onCustomActorsChange: (v: string[]) => void
  // Custom poster
  customPosterPath: string | null
  onCustomPosterSelect: () => void
  // Local ingest
  localIngestMode: boolean
  onLocalIngestModeChange: (v: boolean) => void
  ingestFiles: string[]
  onSelectIngestFiles: () => void
  onRemoveIngestFile: (index: number) => void
}

// ─── Tooltips ──────────────────────────────────────────────────

const modeTooltips: Record<string, string> = {
  mkv_rip: 'Save extracted MKV files to disk via MakeMKV. No re-encoding — preserves original video, audio, and subtitle streams bit-for-bit. Enable alongside other modes to keep the raw MKV copy.',
  raw_capture: 'Full disc backup preserving VIDEO_TS (DVD) or BDMV (Blu-ray) structure, including menus, extras, and all disc metadata. Largest output size.',
  ffv1_archival: 'Re-encode to FFV1 v3 lossless codec with FLAC audio in MKV. Mathematically identical to source — every frame is a keyframe with CRC. Ideal for long-term preservation.',
  streaming_encode: 'Re-encode for streaming using your configured codec (HEVC or H.264). Optimized for Kodi, Plex, and Jellyfin. ~50% smaller than lossless. Surround audio is passed through.',
  kodi_export: 'Full pipeline: extracts from disc, encodes to HEVC/H.264, then organizes into Kodi folder structure with NFO, poster, and fanart. No need to enable MKV Rip separately.',
  jellyfin_export: 'Full pipeline: extracts from disc, encodes to HEVC/H.264, then organizes into Jellyfin folder structure with NFO, poster, and fanart. Identical format to Kodi — compatible with both.',
  plex_export: 'Full pipeline: extracts from disc, encodes to HEVC/H.264, then organizes into Plex folder structure with NFO, poster, and fanart. Identical format to Kodi/Jellyfin — compatible with all three.'
}

const modeConfigs = [
  { key: 'mkv_rip', label: 'MKV Rip', description: 'Save extracted MKV to disk — no re-encode', pathKey: 'paths.mkv_output' },
  { key: 'raw_capture', label: 'Raw Capture', description: 'Full disc backup (VIDEO_TS / BDMV) with menus', pathKey: 'paths.raw_output' },
  { key: 'ffv1_archival', label: 'FFV1 Archival', description: 'Lossless FFV1 v3 + FLAC — archival quality', pathKey: 'paths.ffv1_output' },
  { key: 'streaming_encode', label: 'Streaming Encode', description: 'HEVC/H.264 re-encode — Kodi/Plex ready', pathKey: 'paths.streaming_output' },
  { key: 'jellyfin_export', label: 'Capture for Jellyfin', description: 'Rip \u2192 encode \u2192 organize with Jellyfin-ready NFO, artwork, and folders', pathKey: 'jellyfin.library_path' },
  { key: 'plex_export', label: 'Capture for Plex', description: 'Rip \u2192 encode \u2192 organize with Plex-ready NFO, artwork, and folders', pathKey: 'plex.library_path' },
  { key: 'kodi_export', label: 'Capture for Kodi', description: 'Rip \u2192 encode \u2192 organize with Kodi-ready NFO, artwork, and folders', pathKey: 'kodi.library_path' }
]

// ─── Component ─────────────────────────────────────────────────

export function RipConfigPanel({
  modes, onModesChange,
  convertSubsToSrt, onConvertSubsToSrtChange,
  outputPaths, onOutputPathChange,
  mediaType, onMediaTypeChange,
  title, onTitleChange,
  year, onYearChange,
  tmdbId, onTmdbSelect,
  edition, onEditionChange,
  customEdition, onCustomEditionChange,
  isExtrasDisc, onExtrasDiscChange,
  setName, onSetNameChange,
  onLibrarySelect,
  soundVersion, onSoundVersionChange,
  customSoundVersion, onCustomSoundVersionChange,
  discNumber, onDiscNumberChange,
  totalDiscs, onTotalDiscsChange,
  tvSeason, onTvSeasonChange,
  tvStartEpisode, onTvStartEpisodeChange,
  customPlot, onCustomPlotChange,
  customActors, onCustomActorsChange,
  customPosterPath, onCustomPosterSelect,
  localIngestMode, onLocalIngestModeChange,
  ingestFiles, onSelectIngestFiles, onRemoveIngestFile
}: RipConfigPanelProps) {
  const settings = useAppStore((s) => s.settings)
  const tmdbResult = useDiscStore((s) => s.tmdbResult)
  const mediaLibIsOn = modes.kodi_export || modes.jellyfin_export || modes.plex_export || false

  const [showSearch, setShowSearch] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TMDBResult[]>([])
  const [searching, setSearching] = useState(false)

  const toggleMode = (key: string) => {
    onModesChange({ ...modes, [key]: !modes[key] })
  }

  const selectOutputPath = async (mode: string) => {
    const path = await window.ztr.fs.selectDirectory(`Select output for ${mode}`)
    if (path) onOutputPathChange(mode, path)
  }

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

  const handleTmdbSelect = async (result: TMDBResult) => {
    onTmdbSelect(result)
    onTitleChange(result.title)
    const releaseYear = (result.release_date || result.first_air_date || '').split('-')[0]
    if (releaseYear) onYearChange(releaseYear)
    setShowSearch(false)

    // Auto-fill plot from TMDB
    if (result.overview && !customPlot) {
      onCustomPlotChange(result.overview)
    }

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

  const addActorSlot = () => {
    onCustomActorsChange([...customActors, ''])
  }

  const updateActor = (index: number, value: string) => {
    const updated = [...customActors]
    updated[index] = value
    onCustomActorsChange(updated)
  }

  const removeActor = (index: number) => {
    onCustomActorsChange(customActors.filter((_, i) => i !== index))
  }

  return (
    <Card>
      {/* ═══ RIP MODES SECTION ═══ */}
      <div className="text-amber-400 font-display text-sm font-semibold tracking-wide uppercase mb-2">
        Rip Modes
      </div>
      <div className="border-t border-amber-500/30 mb-3" />

      <div className="space-y-3">
        {modeConfigs.map((config) => (
          <div key={config.key}>
            <div className="flex items-center gap-1">
              <Toggle
                checked={modes[config.key] || false}
                onChange={() => toggleMode(config.key)}
                label={config.label}
                description={config.description}
              />
              <Tooltip content={modeTooltips[config.key]} inline position="right" />
            </div>

            {/* Pipeline explanation for media library modes */}
            {(config.key === 'jellyfin_export' || config.key === 'plex_export' || config.key === 'kodi_export') && modes[config.key] && (
              <p className="ml-12 mt-1 text-[10px] text-zinc-500 font-mono">
                Pipeline: Extract (MKV) &rarr; Encode &rarr; Organize (folders + NFO + artwork)
              </p>
            )}

            {modes[config.key] && (
              <div className="ml-12 mt-2 flex items-center gap-2">
                <Input
                  className="flex-1 text-xs"
                  value={outputPaths[config.key] || settings[config.pathKey] || ''}
                  onChange={(e) => onOutputPathChange(config.key, e.target.value)}
                  placeholder="Output path..."
                />
                <Button variant="ghost" size="sm" onClick={() => selectOutputPath(config.key)}>
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* SRT conversion toggle (shown when no library mode) */}
      {!mediaLibIsOn && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="flex items-center gap-1">
            <Toggle
              checked={convertSubsToSrt}
              onChange={onConvertSubsToSrtChange}
              label="Convert Subtitles to SRT"
              description="OCR image subs to text SRT — needed for players that can't render PGS/VobSub"
            />
            <Tooltip
              content="DVD subtitles (VobSub) and Blu-ray subtitles (PGS) are bitmap images. This option runs tesseract OCR to convert them to searchable text SRT files. Requires tesseract to be installed. Original image subs are always preserved alongside."
              inline
              position="right"
            />
          </div>
        </div>
      )}

      {/* Import Local Files toggle */}
      <div className="mt-3 pt-3 border-t border-zinc-800">
        <div className="flex items-center gap-1">
          <Toggle
            checked={localIngestMode}
            onChange={onLocalIngestModeChange}
            label="Import Local Files"
            description="Process video files from disk instead of a disc drive"
          />
          <Tooltip
            content="Enable to import existing MKV files or VIDEO_TS/AUDIO_TS folders from disk. Skips the disc extraction phase and goes directly to encoding and library export."
            inline
            position="right"
          />
        </div>

        {localIngestMode && (
          <div className="ml-12 mt-2 space-y-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<FolderOpen className="w-3 h-3" />}
              onClick={onSelectIngestFiles}
            >
              Select Files or VIDEO_TS Folder
            </Button>
            {ingestFiles.length > 0 && (
              <div className="space-y-1">
                {ingestFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-zinc-400">
                    <span className="truncate flex-1 font-mono">{file.split('/').pop()}</span>
                    <button
                      onClick={() => onRemoveIngestFile(i)}
                      className="text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ MEDIA OPTIONS SECTION ═══ */}
      {mediaLibIsOn && (
        <>
          <div className="text-amber-400 font-display text-sm font-semibold tracking-wide uppercase mt-6 mb-2">
            Media Options
          </div>
          <div className="border-t border-amber-500/30 mb-3" />

          <div className="space-y-3">
            {/* Media Type */}
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

            {/* Title + Year */}
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

            {/* Search TMDB */}
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

            {/* TV Show: Season + Episode */}
            {mediaType === 'tvshow' && (
              <div className="flex gap-2">
                <div className="flex flex-col gap-1 w-24">
                  <LabelWithTooltip
                    label="Season"
                    tooltip="Season number for TV show episode naming. Used in folder path: Season 01/"
                    className="label-tech"
                  />
                  <input
                    className="input w-full text-center"
                    type="number"
                    min="0"
                    value={tvSeason}
                    onChange={(e) => onTvSeasonChange(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1 w-32">
                  <LabelWithTooltip
                    label="Starting Episode"
                    tooltip="First episode number for auto-sequential numbering. Tracks will be numbered starting from this value."
                    className="label-tech"
                  />
                  <input
                    className="input w-full text-center"
                    type="number"
                    min="1"
                    value={tvStartEpisode}
                    onChange={(e) => onTvStartEpisodeChange(e.target.value)}
                  />
                </div>
              </div>
            )}

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

            {/* Synopsis / Plot */}
            <div className="flex flex-col gap-1">
              <LabelWithTooltip
                label="Synopsis"
                tooltip="Movie or show plot summary. Auto-filled from TMDB when available. Edit for indie discs or to override TMDB plot. Saved to NFO <plot> tag."
                className="label-tech"
              />
              <textarea
                className="input w-full text-xs resize-y"
                rows={3}
                value={customPlot}
                onChange={(e) => onCustomPlotChange(e.target.value)}
                placeholder="Enter a plot synopsis..."
              />
            </div>

            {/* Cast / Actors */}
            <div className="flex flex-col gap-1">
              <LabelWithTooltip
                label="Cast"
                tooltip="Actor names for the NFO <actor> tags. Auto-populated from TMDB when available. Add custom actors for indie discs."
                className="label-tech"
              />
              <div className="space-y-1.5">
                {customActors.map((actor, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      className="input flex-1 text-xs py-1"
                      value={actor}
                      onChange={(e) => updateActor(i, e.target.value)}
                      placeholder={`Actor ${i + 1}`}
                    />
                    <button
                      onClick={() => removeActor(i)}
                      className="text-zinc-600 hover:text-red-400 transition-colors p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  icon={<Plus className="w-3 h-3" />}
                  onClick={addActorSlot}
                >
                  Add Actor
                </Button>
              </div>
            </div>

            {/* Custom Poster Upload */}
            <div className="flex flex-col gap-1">
              <LabelWithTooltip
                label="Custom Poster"
                tooltip="Select a local image to use as the movie/show poster. Overrides TMDB poster. For indie discs not on TMDB."
                className="label-tech"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Upload className="w-3 h-3" />}
                  onClick={onCustomPosterSelect}
                >
                  {customPosterPath ? 'Change Poster' : 'Upload Poster'}
                </Button>
                {customPosterPath && (
                  <span className="text-[10px] text-zinc-500 font-mono truncate">
                    {customPosterPath.split('/').pop()}
                  </span>
                )}
              </div>
            </div>

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

            {/* Sound Version */}
            {mediaType === 'movie' && (
              <div className="flex flex-col gap-1">
                <LabelWithTooltip
                  label="Sound Version"
                  tooltip="Audio format on this disc. Appended to the filename so Kodi/Jellyfin can display it alongside the movie version. Separate from Movie Version (Theatrical, Director's Cut, etc.)."
                  className="label-tech"
                />
                <select className="select w-full pr-8" value={soundVersion} onChange={(e) => onSoundVersionChange(e.target.value)}>
                  <option value="">None</option>
                  {SOUND_VERSIONS.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                {soundVersion === 'Custom' && (
                  <input className="input w-full mt-1" placeholder="Custom audio format..." value={customSoundVersion} onChange={(e) => onCustomSoundVersionChange(e.target.value)} />
                )}
              </div>
            )}

            {/* Disc Number (multi-disc sets) */}
            {mediaType === 'movie' && (
              <div className="flex flex-col gap-1">
                <LabelWithTooltip
                  label="Disc Number"
                  tooltip="For multi-disc movies (e.g., a 2-disc extended edition). Appends '-disc2' to the filename. Leave blank for single-disc movies. Plex and Jellyfin use this to group discs under one movie entry."
                  className="label-tech"
                />
                <div className="flex items-center gap-2">
                  <input
                    className="input w-16 text-center"
                    type="number" min="1"
                    value={discNumber}
                    onChange={(e) => onDiscNumberChange(e.target.value)}
                    placeholder="—"
                  />
                  <span className="text-xs text-zinc-500">of</span>
                  <input
                    className="input w-16 text-center"
                    type="number" min="1"
                    value={totalDiscs}
                    onChange={(e) => onTotalDiscsChange(e.target.value)}
                    placeholder="—"
                  />
                </div>
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
          </div>
        </>
      )}

      {/* ═══ MODALS ═══ */}
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
              onClick={() => handleTmdbSelect(result)}
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
