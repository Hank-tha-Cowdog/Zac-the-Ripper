import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DiscInfoCard } from './DiscInfoCard'
import { TrackSelector } from './TrackSelector'
import { RipConfigPanel } from './RipConfigPanel'
import { RipActionBar } from './RipActionBar'
import { AudioConfigPanel } from './AudioConfigPanel'
import type { LibrarySelection } from './LibraryBrowser'
import { useDiscStore } from '../../stores/disc-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useRipSettings } from '../../hooks/useRipSettings'
import { useDiscDetection } from '../../hooks/useDiscDetection'

export function RipPage() {
  const navigate = useNavigate()
  const {
    discInfo, selectedTracks, selectedDrive, setTmdbResult, updateDiscSession,
    discSession, trackCategories, trackNames
  } = useDiscStore()
  const { addJob } = useJobsStore()
  const [isRipping, setIsRipping] = useState(false)
  const [standbyMessage, setStandbyMessage] = useState<string | null>(null)
  const [musicOutputPath, setMusicOutputPath] = useState('')

  const isAudioCD = discInfo?.discType === 'AUDIO_CD'

  // Load music output path from settings
  useEffect(() => {
    window.ztr.settings.get('paths.music_output').then((val: string) => {
      setMusicOutputPath(val || '~/Music/Zac the Ripper')
    })
  }, [])

  const handleMusicOutputPathChange = (path: string) => {
    setMusicOutputPath(path)
    window.ztr.settings.set('paths.music_output', path)
  }

  // Manual rescan only — global disc detection in App.tsx handles polling + auto-load
  const { rescanDisc } = useDiscDetection({ pollInterval: 0, autoLoadDiscInfo: false })

  const {
    modes, setModes,
    preserveInterlaced, setPreserveInterlaced,
    convertSubsToSrt, setConvertSubsToSrt,
    outputPaths, setOutputPath,
    kodiMediaType, setKodiMediaType,
    kodiTitle, setKodiTitle,
    kodiYear, setKodiYear,
    kodiTmdbId, setKodiTmdbId,
    kodiEdition, setKodiEdition,
    kodiCustomEdition, setKodiCustomEdition,
    kodiIsExtrasDisc, setKodiIsExtrasDisc,
    kodiSetName, setKodiSetName,
    kodiSetOverview, setKodiSetOverview,
    soundVersion, setSoundVersion,
    customSoundVersion, setCustomSoundVersion,
    discNumber, setDiscNumber,
    totalDiscs, setTotalDiscs,
    tvSeason, setTvSeason,
    tvStartEpisode, setTvStartEpisode,
    localIngestMode, setLocalIngestMode
  } = useRipSettings()

  const handleEject = async () => {
    if (selectedDrive === null) return
    await window.ztr.disc.eject(selectedDrive)
    navigate('/')
  }

  const handleLibrarySelect = async (selection: LibrarySelection) => {
    const { movie, setName, setOverview } = selection
    setKodiTitle(movie.title)
    if (movie.year) setKodiYear(String(movie.year))
    if (setName) setKodiSetName(setName)
    if (setOverview) setKodiSetOverview(setOverview)

    // Auto-populate TMDB data from existing movie's NFO
    if (movie.tmdbId) {
      setKodiTmdbId(movie.tmdbId)
      try {
        const details = await window.ztr.tmdb.getDetails(movie.tmdbId, 'movie')
        const year = movie.year ? String(movie.year) : ''
        const tmdbResult = {
          id: movie.tmdbId,
          title: movie.title,
          year,
          poster_path: details?.poster_path || null,
          overview: details?.overview || '',
          vote_average: details?.vote_average || 0,
          belongs_to_collection: details?.belongs_to_collection || null
        }
        setTmdbResult(tmdbResult)
        updateDiscSession({
          kodiTitle: movie.title,
          kodiYear: year,
          kodiTmdbId: movie.tmdbId,
          sessionDiscId: discInfo?.discId ?? '__user_pending__'
        })

        // Auto-populate synopsis from TMDB
        if (details?.overview && !discSession.customPlot) {
          updateDiscSession({ customPlot: details.overview })
        }

        // Auto-populate collection from TMDB if NFO didn't have it
        if (details?.belongs_to_collection?.name && !setName) {
          setKodiSetName(details.belongs_to_collection.name)
        }

        // Cache TMDB result for disc recognition
        if (discInfo?.discId) {
          window.ztr.disc.setTmdbCache(discInfo.discId, tmdbResult).catch(() => {})
        }
      } catch (err) {
        console.warn('Failed to fetch TMDB details for library movie:', err)
      }
    }
  }

  const handleCustomPosterSelect = async () => {
    const path = await window.ztr.fs.selectFile('Select Poster Image', [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }
    ])
    if (path) {
      updateDiscSession({ customPosterPath: path })
    }
  }

  const handleSelectIngestFiles = async () => {
    const files = await window.ztr.fs.selectFiles('Select Video Files or VIDEO_TS Folder', {
      filters: [
        { name: 'Video Files', extensions: ['mkv', 'mp4', 'avi', 'm4v', 'ts'] }
      ],
      multiSelections: true
    })
    if (files && files.length > 0) {
      updateDiscSession({
        ingestFiles: [...discSession.ingestFiles, ...files]
      })
    }
  }

  const handleRemoveIngestFile = (index: number) => {
    updateDiscSession({
      ingestFiles: discSession.ingestFiles.filter((_, i) => i !== index)
    })
  }

  const handleAudioRip = async () => {
    if (selectedTracks.length === 0) return

    setIsRipping(true)
    setStandbyMessage('Standby — preparing to rip audio CD')

    const { musicArtist, musicAlbumArtist, musicAlbum, musicYear,
            musicDiscNumber, musicTotalDiscs, musicTracks,
            musicMbReleaseId, musicIsVariousArtists, musicCoverArtPath } = discSession

    // Map selected track IDs (0-based) back to 1-based track numbers
    const trackNumbers = selectedTracks.map(id => id + 1)

    // Filter music tracks to only selected ones, preserving order
    const selectedMusicTracks = trackNumbers.map(num => {
      const mt = musicTracks.find(t => t.number === num)
      return mt || { number: num, title: `Track ${num}`, artist: musicArtist }
    })

    try {
      const result = await window.ztr.audio.rip({
        trackNumbers,
        artist: musicArtist || musicAlbumArtist || 'Unknown Artist',
        albumArtist: musicAlbumArtist || musicArtist || 'Unknown Artist',
        album: musicAlbum || 'Unknown Album',
        year: musicYear || '',
        discNumber: musicDiscNumber || 1,
        totalDiscs: musicTotalDiscs || 1,
        tracks: selectedMusicTracks,
        mbReleaseId: musicMbReleaseId,
        isVariousArtists: musicIsVariousArtists,
        coverArtPath: musicCoverArtPath,
        devicePath: discInfo?.metadata?.devicePath
      })

      if (result?.jobId) {
        addJob({
          jobId: result.jobId,
          dbId: result.dbId,
          type: 'music_export',
          status: 'running',
          percentage: 0,
          message: 'Preparing audio rip...',
          movieTitle: `${musicArtist || 'Unknown'} - ${musicAlbum || 'Unknown'}`
        })
        setTimeout(() => navigate('/progress'), 1500)
      }
    } catch (err) {
      console.error('Audio rip failed:', err)
      setIsRipping(false)
      setStandbyMessage(null)
    }
  }

  const handleRip = async () => {
    // For ingest mode, don't require disc drive
    const isIngest = localIngestMode && discSession.ingestFiles.length > 0
    if (!isIngest && (selectedDrive === null || selectedTracks.length === 0)) return
    if (isIngest && discSession.ingestFiles.length === 0) return

    // Delegate to audio rip for audio CDs
    if (isAudioCD && !isIngest) {
      return handleAudioRip()
    }

    setIsRipping(true)
    setStandbyMessage(isIngest ? 'Standby — preparing to process local files' : 'Standby — your disc drive is coming up to speed')

    const enabledModes = Object.entries(modes).filter(([, v]) => v).map(([k]) => k)
    const outputDir = outputPaths.mkv_rip || ''

    // Build track metadata for multi-track extras categorization
    const isLibraryMode = modes.kodi_export || modes.jellyfin_export || modes.plex_export
    const longestTrackId = discInfo && discInfo.tracks.length > 0
      ? discInfo.tracks.reduce((a, b) => a.durationSeconds > b.durationSeconds ? a : b).id
      : -1
    const trackMeta = isLibraryMode && !isIngest && selectedTracks.length > 1 && kodiMediaType !== 'tvshow'
      ? selectedTracks.map((id, idx) => {
          const cat = trackCategories[id] || (id === longestTrackId ? 'main' : 'featurette')
          const track = discInfo?.tracks.find(t => t.id === id)
          const isGeneric = !track?.title || /^Title\s+\d+$/i.test(track.title)
          const extrasIndex = selectedTracks.filter(tid => {
            const tidCat = trackCategories[tid] || (tid === longestTrackId ? 'main' : 'featurette')
            return tidCat !== 'main'
          }).indexOf(id)
          const name = trackNames[id] || (isGeneric
            ? `${kodiTitle || 'Bonus'} - Bonus ${String(extrasIndex + 1).padStart(3, '0')}`
            : track?.title || `Bonus ${String(idx + 1).padStart(3, '0')}`)
          return { titleId: id, category: cat, name }
        })
      : undefined

    // Build TV show options when mediaType is tvshow
    const tvOptions = isLibraryMode && kodiMediaType === 'tvshow' ? {
      showName: kodiTitle,
      year: kodiYear,
      season: parseInt(tvSeason) || 1,
      episodes: selectedTracks.map((id, idx) => ({
        trackId: id,
        episodeNumber: discSession.tvEpisodeNumbers[id] ?? (parseInt(tvStartEpisode) || 1) + idx,
        episodeTitle: discSession.tvEpisodeTitles[id] || ''
      }))
    } : undefined

    try {
      const result = await window.ztr.rip.start({
        discIndex: isIngest ? 0 : selectedDrive,
        titleIds: isIngest ? [] : selectedTracks,
        outputDir,
        modes: enabledModes,
        preserveInterlaced,
        convertSubsToSrt,
        trackMeta,
        isIngest,
        ingestFiles: isIngest ? discSession.ingestFiles : undefined,
        kodiOptions: isLibraryMode ? {
          mediaType: kodiMediaType,
          title: kodiTitle,
          year: kodiYear,
          tmdbId: kodiTmdbId,
          // Movie-specific options (only for movies, not TV shows)
          ...(kodiMediaType === 'movie' ? {
            edition: kodiEdition === 'Custom' ? kodiCustomEdition : kodiEdition || undefined,
            isExtrasDisc: kodiIsExtrasDisc || undefined,
            soundVersion: soundVersion === 'Custom' ? customSoundVersion : soundVersion || undefined,
            discNumber: parseInt(discNumber) || undefined,
            totalDiscs: parseInt(totalDiscs) || undefined,
          } : {}),
          setName: kodiSetName || undefined,
          setOverview: kodiSetOverview || undefined,
          customPlot: discSession.customPlot || undefined,
          customActors: discSession.customActors.filter(a => a.trim()) || undefined,
          customPosterPath: discSession.customPosterPath || undefined,
          tvOptions
        } : undefined
      })

      if (result?.jobId) {
        addJob({
          jobId: result.jobId,
          dbId: result.dbId,
          type: enabledModes[0] || 'mkv_rip',
          status: 'running',
          percentage: 0,
          message: isIngest ? 'Processing local files...' : 'Disc drive spinning up...',
          movieTitle: kodiTitle || undefined,
          movieYear: kodiYear || undefined,
          collectionName: kodiSetName || undefined,
          edition: kodiEdition === 'Custom' ? kodiCustomEdition : kodiEdition || undefined,
          soundVersion: soundVersion === 'Custom' ? customSoundVersion : soundVersion || undefined,
          discNumber: parseInt(discNumber) || undefined,
          totalDiscs: parseInt(totalDiscs) || undefined
        })
        setTimeout(() => navigate('/progress'), 1500)
      }
    } catch (err) {
      console.error('Rip failed:', err)
      setIsRipping(false)
      setStandbyMessage(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-purple-400 font-display">Rip Disc</h1>

      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-3 space-y-4">
          <DiscInfoCard onRescan={rescanDisc} />
          <TrackSelector
            isLibraryMode={!isAudioCD && (modes.kodi_export || modes.jellyfin_export || modes.plex_export)}
            movieTitle={isAudioCD ? discSession.musicAlbum : kodiTitle}
            mediaType={kodiMediaType}
            tvSeason={tvSeason}
            tvStartEpisode={tvStartEpisode}
          />
        </div>

        <div className="col-span-2 space-y-4">
          {isAudioCD ? (
            <AudioConfigPanel
              musicOutputPath={musicOutputPath}
              onMusicOutputPathChange={handleMusicOutputPathChange}
            />
          ) : (
            <RipConfigPanel
              modes={modes}
              onModesChange={setModes}
              convertSubsToSrt={convertSubsToSrt}
              onConvertSubsToSrtChange={setConvertSubsToSrt}
              outputPaths={outputPaths}
              onOutputPathChange={setOutputPath}
              mediaType={kodiMediaType}
              onMediaTypeChange={setKodiMediaType}
              title={kodiTitle}
              onTitleChange={setKodiTitle}
              year={kodiYear}
              onYearChange={setKodiYear}
              tmdbId={kodiTmdbId}
              onTmdbSelect={(r) => {
                const year = (r.release_date || r.first_air_date || '').split('-')[0]
                setKodiTmdbId(r.id)
                const tmdbResult = {
                  id: r.id,
                  title: r.title,
                  year,
                  poster_path: r.poster_path,
                  overview: r.overview,
                  vote_average: r.vote_average,
                  belongs_to_collection: null
                }
                setTmdbResult(tmdbResult)
                updateDiscSession({
                  kodiTitle: r.title,
                  kodiYear: year,
                  kodiTmdbId: r.id,
                  sessionDiscId: discInfo?.discId ?? '__user_pending__'
                })
                // Auto-fill plot
                if (r.overview && !discSession.customPlot) {
                  updateDiscSession({ customPlot: r.overview })
                }
                // Cache TMDB result for disc recognition
                if (discInfo?.discId) {
                  window.ztr.disc.setTmdbCache(discInfo.discId, tmdbResult).catch(() => {})
                }
              }}
              edition={kodiEdition}
              onEditionChange={setKodiEdition}
              customEdition={kodiCustomEdition}
              onCustomEditionChange={setKodiCustomEdition}
              isExtrasDisc={kodiIsExtrasDisc}
              onExtrasDiscChange={setKodiIsExtrasDisc}
              setName={kodiSetName}
              onSetNameChange={setKodiSetName}
              onLibrarySelect={handleLibrarySelect}
              soundVersion={soundVersion}
              onSoundVersionChange={setSoundVersion}
              customSoundVersion={customSoundVersion}
              onCustomSoundVersionChange={setCustomSoundVersion}
              discNumber={discNumber}
              onDiscNumberChange={setDiscNumber}
              totalDiscs={totalDiscs}
              onTotalDiscsChange={setTotalDiscs}
              tvSeason={tvSeason}
              onTvSeasonChange={setTvSeason}
              tvStartEpisode={tvStartEpisode}
              onTvStartEpisodeChange={setTvStartEpisode}
              customPlot={discSession.customPlot}
              onCustomPlotChange={(v) => updateDiscSession({ customPlot: v })}
              customActors={discSession.customActors}
              onCustomActorsChange={(v) => updateDiscSession({ customActors: v })}
              customPosterPath={discSession.customPosterPath}
              onCustomPosterSelect={handleCustomPosterSelect}
              localIngestMode={localIngestMode}
              onLocalIngestModeChange={setLocalIngestMode}
              ingestFiles={discSession.ingestFiles}
              onSelectIngestFiles={handleSelectIngestFiles}
              onRemoveIngestFile={handleRemoveIngestFile}
            />
          )}
        </div>
      </div>

      <RipActionBar
        modes={modes}
        onRip={handleRip}
        onEject={handleEject}
        isRipping={isRipping}
        standbyMessage={standbyMessage}
      />
    </div>
  )
}
