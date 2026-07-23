import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Disc3 } from 'lucide-react'
import { DiscInfoCard } from './DiscInfoCard'
import { TrackSelector } from './TrackSelector'
import { RipConfigPanel } from './RipConfigPanel'
import { RipActionBar } from './RipActionBar'
import { AudioConfigPanel } from './AudioConfigPanel'
import { Button } from '../ui'
import type { LibrarySelection } from './LibraryBrowser'
import { useDiscStore } from '../../stores/disc-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useRipSettings } from '../../hooks/useRipSettings'
import { useDiscDetection } from '../../hooks/useDiscDetection'

export function RipPage() {
  const navigate = useNavigate()
  const {
    discInfo, selectedTracks, selectedDrive, setTmdbResult, updateDiscSession,
    discSession, trackCategories, trackNames, tmdbResult
  } = useDiscStore()
  const { addJob, recentJobs } = useJobsStore()
  const [isRipping, setIsRipping] = useState(false)
  const [standbyMessage, setStandbyMessage] = useState<string | null>(null)
  const [musicOutputPath, setMusicOutputPath] = useState('')

  const isAudioCD = discInfo?.discType === 'AUDIO_CD'

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
    localIngestMode, setLocalIngestMode,
    libraryTitle, libraryYear, libraryTmdbId, librarySetName, librarySetOverview, libraryPosterPath,
    saveLibraryContext, clearLibraryContext,
    persistedCollectionName,
    batchModeEnabled, setBatchModeEnabled
  } = useRipSettings()

  // ── Batch/auto-rip mode ──────────────────────────────────────
  // Off by default. When on: a newly-detected, fully-selectable disc gets
  // a cancelable countdown before auto-starting (using whatever config is
  // currently set, same as a manual RIP! click), and completion
  // auto-ejects so the next disc can go in. Deliberately conservative:
  // visible + cancelable rather than instant/silent, since this starts
  // hours-long jobs and physically ejects media unattended.
  const [autoRipCountdown, setAutoRipCountdown] = useState<number | null>(null)
  // Fingerprint of the disc a countdown was already offered for — set the
  // moment the countdown starts (not when the rip actually fires), so
  // cancelling means "skip auto-rip for this disc," not "retry in a loop."
  const autoRipOfferedForRef = useRef<string | null>(null)
  const autoEjectJobIdRef = useRef<string | null>(null)
  const AUTO_RIP_COUNTDOWN_SECONDS = 5

  // Load music output path from settings
  useEffect(() => {
    window.ztr.settings.get('paths.music_output').then((val: string) => {
      setMusicOutputPath(val || '~/Music/Zac the Ripper')
    })
  }, [])

  // On disc change: clear "Add to Existing Movie" linked context (must be re-selected each disc)
  // but restore the persisted collection name if one exists.
  useEffect(() => {
    if (!discInfo?.fingerprint) return
    if (!discSession.sessionDiscId) {
      // Clear any stale library link so user must re-select "Add to Existing Movie"
      if (libraryTitle) {
        clearLibraryContext()
      }
      // Restore persisted collection name (survives disc changes until manually cleared)
      if (persistedCollectionName) {
        updateDiscSession({
          kodiSetName: persistedCollectionName,
          sessionDiscId: discInfo.discId
        })
      }
    }
  }, [discInfo?.fingerprint])

  const handleMusicOutputPathChange = (path: string) => {
    setMusicOutputPath(path)
    window.ztr.settings.set('paths.music_output', path)
  }

  const handleEject = async () => {
    if (selectedDrive === null) return
    await window.ztr.disc.eject(selectedDrive)
    // Without this, discInfo/selectedTracks/discSession kept showing the
    // just-ejected disc until the next poll happened to rescan — during
    // that window RIP! was still clickable and would submit the old
    // disc's track selection against whatever's now in the drive.
    useDiscStore.getState().setDiscInfo(null)
    useDiscStore.getState().resetDiscSession()
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
        const finalSetName = setName || details?.belongs_to_collection?.name || ''
        if (details?.belongs_to_collection?.name && !setName) {
          setKodiSetName(details.belongs_to_collection.name)
        }

        // Persist library context to SQLite for multi-disc workflows
        saveLibraryContext({
          title: movie.title,
          year: year,
          tmdbId: String(movie.tmdbId || ''),
          setName: finalSetName,
          setOverview: setOverview || '',
          posterPath: details?.poster_path || ''
        })

        // Cache TMDB result for disc recognition
        if (discInfo?.discId) {
          window.ztr.disc.setTmdbCache(discInfo.discId, tmdbResult).catch(() => {})
        }
      } catch (err) {
        console.warn('Failed to fetch TMDB details for library movie:', err)
      }
    } else {
      // No TMDB ID — still persist basic library context
      saveLibraryContext({
        title: movie.title,
        year: movie.year ? String(movie.year) : '',
        tmdbId: '',
        setName: setName || '',
        setOverview: setOverview || '',
        posterPath: ''
      })
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
            musicMbReleaseId, musicIsVariousArtists, musicCoverArtPath,
            musicAlbumArtistId, musicGenre } = discSession

    // Map selected track IDs (0-based) back to 1-based track numbers
    const trackNumbers = selectedTracks.map(id => id + 1)

    // Filter music tracks to only selected ones, preserving order
    const selectedMusicTracks = trackNumbers.map(num => {
      const mt = musicTracks.find(t => t.number === num)
      return mt || { number: num, title: `Track ${num}`, artist: musicArtist, recordingId: '' }
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
        devicePath: discInfo?.metadata?.devicePath,
        albumArtistId: musicAlbumArtistId,
        genre: musicGenre,
        discId: discInfo?.metadata?.musicbrainzDiscId || null
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
        if (batchModeEnabled) autoEjectJobIdRef.current = result.jobId
        setTimeout(() => navigate('/progress'), 1500)
      } else {
        // See handleRip — an IPC handler resolving with { error } instead
        // of throwing left the UI permanently stuck on "Standby..." with
        // no reset and no feedback.
        const message = (result as { error?: string } | undefined)?.error || 'Audio rip failed to start'
        console.error('Audio rip failed to start:', message)
        setStandbyMessage(`Error: ${message}`)
        setIsRipping(false)
        setTimeout(() => setStandbyMessage(null), 5000)
      }
    } catch (err) {
      console.error('Audio rip failed:', err)
      const message = err instanceof Error ? err.message : String(err)
      setStandbyMessage(`Error: ${message}`)
      setIsRipping(false)
      setTimeout(() => setStandbyMessage(null), 5000)
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

    // For TV shows, get the default category for each track
    // When extras disc is on, ALL tracks are extras — no main feature
    const getTrackCategory = (id: number) => {
      if (kodiIsExtrasDisc) return trackCategories[id] || 'featurette'
      if (trackCategories[id]) return trackCategories[id]
      if (kodiMediaType === 'tvshow') return 'episode'
      return id === longestTrackId ? 'main' : 'featurette'
    }

    // Build track metadata for ALL selected tracks (main + extras).
    // Each entry carries the titleId so the pipeline can match output files correctly.
    let extrasCounter = 0
    const trackMeta = isLibraryMode && !isIngest && selectedTracks.length > 0
      ? selectedTracks.map((id) => {
          const cat = getTrackCategory(id)
          const track = discInfo?.tracks.find(t => t.id === id)
          let name: string
          if (cat === 'main') {
            name = kodiTitle || track?.title || 'Main Feature'
          } else if (cat === 'episode') {
            name = track?.title || `Episode`
          } else {
            extrasCounter++
            const isGeneric = !track?.title || /^Title\s+\d+$/i.test(track.title)
            name = trackNames[id] || (isGeneric
              ? `${kodiTitle || 'Bonus'} - Bonus ${String(extrasCounter).padStart(3, '0')}`
              : track?.title || `Bonus ${String(extrasCounter).padStart(3, '0')}`)
          }
          return { titleId: id, category: cat, name }
        })
      : undefined

    // Build TV show options — only include episode-categorized tracks
    const tvOptions = isLibraryMode && kodiMediaType === 'tvshow' ? (() => {
      const episodeTracks = selectedTracks.filter(id => getTrackCategory(id) === 'episode')
      return {
        showName: kodiTitle,
        year: kodiYear,
        season: parseInt(tvSeason) || 1,
        episodes: episodeTracks.map((id, idx) => ({
          trackId: id,
          episodeNumber: discSession.tvEpisodeNumbers[id] ?? (parseInt(tvStartEpisode) || 1) + idx,
          episodeTitle: discSession.tvEpisodeTitles[id] || ''
        }))
      }
    })() : undefined

    // Build poster URL for progress display
    const posterUrl = discSession.customPosterPath
      ? `file://${discSession.customPosterPath}`
      : tmdbResult?.poster_path
        ? `https://image.tmdb.org/t/p/w185${tmdbResult.poster_path}`
        : undefined

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
        posterUrl,
        expectedDiscId: isIngest ? undefined : discInfo?.discId,
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
          } : {}),
          // Disc number applies to both movies and TV box sets
          discNumber: parseInt(discNumber) || undefined,
          totalDiscs: parseInt(totalDiscs) || undefined,
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
          // The backend decides the actual primary job type (e.g. by which
          // library has a configured path, for combined export modes) —
          // enabledModes[0] is just "whichever checkbox comes first in a
          // fixed declaration order" and disagreed with it whenever modes
          // were combined (e.g. ffv1_archival + kodi_export), mislabeling
          // the whole pipeline's badge/messages.
          type: (result as { type?: string }).type || enabledModes[0] || 'mkv_rip',
          status: 'running',
          percentage: 0,
          message: isIngest ? 'Processing local files...' : 'Disc drive spinning up...',
          movieTitle: kodiTitle || undefined,
          movieYear: kodiYear || undefined,
          collectionName: kodiSetName || undefined,
          edition: kodiEdition === 'Custom' ? kodiCustomEdition : kodiEdition || undefined,
          soundVersion: soundVersion === 'Custom' ? customSoundVersion : soundVersion || undefined,
          discNumber: parseInt(discNumber) || undefined,
          totalDiscs: parseInt(totalDiscs) || undefined,
          posterUrl
        })
        if (batchModeEnabled) autoEjectJobIdRef.current = result.jobId
        setTimeout(() => navigate('/progress'), 1500)
      } else {
        // IPC handlers here can resolve with { error } instead of throwing
        // (e.g. "No window found", or nothing selected) — without this
        // branch the UI stayed stuck showing "Standby — preparing to rip"
        // forever, since only the catch{} block below ever reset it.
        const message = (result as { error?: string } | undefined)?.error || 'Rip failed to start'
        console.error('Rip failed to start:', message)
        setStandbyMessage(`Error: ${message}`)
        setIsRipping(false)
        setTimeout(() => setStandbyMessage(null), 5000)
      }
    } catch (err) {
      console.error('Rip failed:', err)
      const message = err instanceof Error ? err.message : String(err)
      setStandbyMessage(`Error: ${message}`)
      setIsRipping(false)
      setTimeout(() => setStandbyMessage(null), 5000)
    }
  }

  const enabledModesForButton = Object.entries(modes).filter(([, v]) => v).map(([k]) => k)
  const canRip = selectedTracks.length > 0 && enabledModesForButton.length > 0 && !isRipping

  // Offer a countdown the first time a newly-detected disc becomes
  // selectable. Guarded by the ref (not just fingerprint in the dep
  // array) so cancelling doesn't re-offer on the next unrelated re-render
  // — cancelling means "I'll handle this disc myself."
  useEffect(() => {
    if (!batchModeEnabled) return
    if (!discInfo?.fingerprint) return
    if (!canRip) return
    if (autoRipOfferedForRef.current === discInfo.fingerprint) return

    autoRipOfferedForRef.current = discInfo.fingerprint
    setAutoRipCountdown(AUTO_RIP_COUNTDOWN_SECONDS)
  }, [batchModeEnabled, discInfo?.fingerprint, canRip])

  // Tick the countdown down; fire the rip at zero. handleRip() itself
  // already delegates to handleAudioRip() for audio CDs (see its own body
  // below) — same single entry point the manual RIP! button uses. Both
  // branches defer through setTimeout (even the "fire now" one, at 0ms)
  // rather than calling setState synchronously in the effect body, which
  // would otherwise trigger a cascading render within the same commit.
  useEffect(() => {
    if (autoRipCountdown === null) return
    if (autoRipCountdown <= 0) {
      const timer = setTimeout(() => {
        setAutoRipCountdown(null)
        handleRip()
      }, 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => setAutoRipCountdown((c) => (c === null ? null : c - 1)), 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-fires only on the countdown tick, not on every handleRip identity change
  }, [autoRipCountdown])

  const cancelAutoRip = () => setAutoRipCountdown(null)

  // After a batch-started job finishes (success or failure — either way
  // the drive is free), eject automatically so the next disc can go in.
  useEffect(() => {
    if (!autoEjectJobIdRef.current) return
    const finished = recentJobs.find(j => j.jobId === autoEjectJobIdRef.current)
    if (!finished) return

    autoEjectJobIdRef.current = null
    const timer = setTimeout(() => {
      handleEject()
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleEject is stable enough in practice; re-running this on its identity change would risk double-firing the eject timer
  }, [recentJobs])

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-purple-400 font-display animate-header-glow">Rip Disc</h1>

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
          {/* Top Rip Button */}
          <Button
            variant="primary"
            size="lg"
            className={`w-full text-lg font-display tracking-wide ${isRipping ? 'animate-rip-button' : canRip ? 'animate-rip-ready' : ''}`}
            disabled={!canRip}
            onClick={handleRip}
            icon={<Disc3 className={`w-5 h-5${isRipping ? ' animate-spin' : ''}`} />}
          >
            <span className={isRipping ? 'animate-rip-text' : ''}>
              {isRipping ? 'Ripping...' : 'RIP!'}
            </span>
          </Button>

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
              libraryTitle={libraryTitle}
              libraryYear={libraryYear}
              onClearLibraryContext={() => {
                clearLibraryContext()
                updateDiscSession({
                  kodiTitle: '',
                  kodiYear: '',
                  kodiTmdbId: null,
                  kodiSetName: '',
                  kodiSetOverview: '',
                  sessionDiscId: null
                })
                setTmdbResult(null)
              }}
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
        batchModeEnabled={batchModeEnabled}
        onToggleBatchMode={setBatchModeEnabled}
        autoRipCountdown={autoRipCountdown}
        onCancelAutoRip={cancelAutoRip}
      />
    </div>
  )
}
