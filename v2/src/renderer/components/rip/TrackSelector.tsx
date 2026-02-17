import React from 'react'
import { Clock, HardDrive, Film, Music, Subtitles } from 'lucide-react'
import { Card, Badge, Button, TechLabel } from '../ui'
import { useDiscStore } from '../../stores/disc-store'

function isGenericName(name: string): boolean {
  return /^Title\s+\d+$/i.test(name)
}

const MOVIE_CATEGORY_OPTIONS = [
  { value: 'main', label: 'Main Feature' },
  { value: 'behindthescenes', label: 'Behind The Scenes' },
  { value: 'deleted', label: 'Deleted Scenes' },
  { value: 'featurette', label: 'Featurette' },
  { value: 'interview', label: 'Interview' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'short', label: 'Short' },
  { value: 'other', label: 'Other' }
]

const TV_CATEGORY_OPTIONS = [
  { value: 'episode', label: 'Episode' },
  { value: 'behindthescenes', label: 'Behind The Scenes' },
  { value: 'deleted', label: 'Deleted Scenes' },
  { value: 'featurette', label: 'Featurette' },
  { value: 'interview', label: 'Interview' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'short', label: 'Short' },
  { value: 'other', label: 'Other' }
]

interface TrackSelectorProps {
  isLibraryMode?: boolean
  movieTitle?: string
  mediaType?: string
  tvSeason?: string
  tvStartEpisode?: string
}

export function TrackSelector({ isLibraryMode, movieTitle, mediaType, tvSeason, tvStartEpisode }: TrackSelectorProps) {
  const {
    discInfo, selectedTracks, toggleTrack, selectAllTracks, selectMainFeature,
    trackCategories, trackNames, setTrackCategory, setTrackName,
    discSession, setTvEpisodeTitle, setTvEpisodeNumber
  } = useDiscStore()

  if (!discInfo) return null

  const isTVShow = mediaType === 'tvshow' && isLibraryMode
  const showCategoryUI = isLibraryMode && selectedTracks.length > 1

  // Find the longest track id for auto-assigning 'main'
  const longestTrackId = discInfo.tracks.length > 0
    ? discInfo.tracks.reduce((a, b) => a.durationSeconds > b.durationSeconds ? a : b).id
    : -1

  const categoryOptions = isTVShow ? TV_CATEGORY_OPTIONS : MOVIE_CATEGORY_OPTIONS

  const getCategory = (trackId: number) => {
    if (trackCategories[trackId]) return trackCategories[trackId]
    if (isTVShow) return 'episode'
    return trackId === longestTrackId ? 'main' : 'featurette'
  }

  const getTrackName = (trackId: number, trackTitle: string) => {
    if (trackNames[trackId]) return trackNames[trackId]
    if (!isGenericName(trackTitle)) return trackTitle
    const extrasIndex = selectedTracks.filter(id => id !== longestTrackId).indexOf(trackId)
    return `${movieTitle || 'Bonus'} - Bonus ${String(extrasIndex + 1).padStart(3, '0')}`
  }

  // Auto-sequential episode number for a track based on its position in selectedTracks
  const getEpisodeNumber = (trackId: number) => {
    if (discSession.tvEpisodeNumbers[trackId] !== undefined) {
      return discSession.tvEpisodeNumbers[trackId]
    }
    const idx = selectedTracks.indexOf(trackId)
    return (parseInt(tvStartEpisode || '1') || 1) + idx
  }

  const getEpisodeTitle = (trackId: number) => {
    return discSession.tvEpisodeTitles[trackId] || ''
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <TechLabel>Title Tracks</TechLabel>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={selectAllTracks}>
            Select All
          </Button>
          <Button variant="ghost" size="sm" onClick={selectMainFeature}>
            Main Feature Only
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {discInfo.tracks.map((track) => {
          const isSelected = selectedTracks.includes(track.id)
          const category = getCategory(track.id)
          return (
            <Card
              key={track.id}
              variant="solid"
              className={`cursor-pointer transition-all ${
                isSelected ? 'border-purple-500/50 bg-purple-500/5' : ''
              }`}
              padding={false}
            >
              <div
                className="p-3"
                onClick={() => toggleTrack(track.id)}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    className="accent-purple-600"
                  />
                  <span className="text-sm font-medium text-zinc-100">
                    {track.title}
                  </span>

                  {track.resolution && (
                    <Badge variant={track.isInterlaced ? 'warning' : 'info'}>
                      {track.resolution}
                    </Badge>
                  )}

                  <div className="flex items-center gap-1 text-xs text-zinc-500 font-mono">
                    <Clock className="w-3 h-3" />
                    {track.duration}
                  </div>

                  <div className="flex items-center gap-1 text-xs text-zinc-500 font-mono">
                    <HardDrive className="w-3 h-3" />
                    {track.size}
                  </div>

                  {track.chapters > 0 && (
                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                      <Film className="w-3 h-3" />
                      {track.chapters} ch
                    </div>
                  )}

                  {track.framerate && (
                    <Badge variant="info">{track.framerate}fps</Badge>
                  )}
                </div>

                {/* Track categorization UI for library export mode */}
                {showCategoryUI && isSelected && (
                  <div className="mt-2 ml-7 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <select
                      className="bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 px-2 py-1 w-36"
                      value={category}
                      onChange={(e) => setTrackCategory(track.id, e.target.value)}
                    >
                      {categoryOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {/* Episode number for TV episode tracks */}
                    {isTVShow && category === 'episode' && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">S{String(parseInt(tvSeason || '1')).padStart(2, '0')}E</span>
                        <input
                          className="bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 px-2 py-1 w-14 text-center"
                          type="number"
                          min="1"
                          value={getEpisodeNumber(track.id)}
                          onChange={(e) => setTvEpisodeNumber(track.id, parseInt(e.target.value) || 1)}
                        />
                      </div>
                    )}
                    {/* Extras name for non-main/non-episode tracks */}
                    {category !== 'main' && category !== 'episode' && (
                      <input
                        className="bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 px-2 py-1 flex-1"
                        value={getTrackName(track.id, track.title)}
                        onChange={(e) => setTrackName(track.id, e.target.value)}
                        placeholder="Bonus feature name..."
                      />
                    )}
                  </div>
                )}

                {/* Audio tracks */}
                {track.audioTracks.length > 0 && (
                  <div className="mt-2 ml-7 flex flex-wrap gap-1">
                    <Music className="w-3 h-3 text-zinc-600 mt-0.5" />
                    {track.audioTracks.map((audio) => (
                      <Badge key={audio.id} variant="default">
                        {audio.codec} {audio.channels} {audio.language.toUpperCase()}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Subtitle tracks */}
                {track.subtitleTracks.length > 0 && (
                  <div className="mt-1 ml-7 flex flex-wrap gap-1">
                    <Subtitles className="w-3 h-3 text-zinc-600 mt-0.5" />
                    {track.subtitleTracks.map((sub) => (
                      <Badge key={sub.id} variant="info">
                        {sub.type} {sub.language.toUpperCase()}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
