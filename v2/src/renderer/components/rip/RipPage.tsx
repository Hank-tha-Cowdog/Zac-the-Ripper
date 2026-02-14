import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DiscInfoCard } from './DiscInfoCard'
import { TrackSelector } from './TrackSelector'
import { RipModesPanel } from './RipModesPanel'
import { RipActionBar } from './RipActionBar'
import { KodiOptionsPanel } from './KodiOptionsPanel'
import type { LibrarySelection } from './LibraryBrowser'
import { useDiscStore } from '../../stores/disc-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useRipSettings } from '../../hooks/useRipSettings'
import { useDiscDetection } from '../../hooks/useDiscDetection'

export function RipPage() {
  const navigate = useNavigate()
  const { discInfo, selectedTracks, selectedDrive, setTmdbResult, updateDiscSession, trackCategories, trackNames } = useDiscStore()
  const { addJob } = useJobsStore()
  const [isRipping, setIsRipping] = useState(false)
  const [standbyMessage, setStandbyMessage] = useState<string | null>(null)

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
    totalDiscs, setTotalDiscs
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

  const handleRip = async () => {
    if (selectedDrive === null || selectedTracks.length === 0) return

    setIsRipping(true)
    setStandbyMessage('Standby — your disc drive is coming up to speed')

    const enabledModes = Object.entries(modes).filter(([, v]) => v).map(([k]) => k)
    const outputDir = outputPaths.mkv_rip || ''

    // Build track metadata for multi-track extras categorization
    const isLibraryMode = modes.kodi_export || modes.jellyfin_export || modes.plex_export
    const longestTrackId = discInfo && discInfo.tracks.length > 0
      ? discInfo.tracks.reduce((a, b) => a.durationSeconds > b.durationSeconds ? a : b).id
      : -1
    const trackMeta = isLibraryMode && selectedTracks.length > 1
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

    try {
      const result = await window.ztr.rip.start({
        discIndex: selectedDrive,
        titleIds: selectedTracks,
        outputDir,
        modes: enabledModes,
        preserveInterlaced,
        convertSubsToSrt,
        trackMeta,
        kodiOptions: (modes.kodi_export || modes.jellyfin_export || modes.plex_export) ? {
          mediaType: kodiMediaType,
          title: kodiTitle,
          year: kodiYear,
          tmdbId: kodiTmdbId,
          edition: kodiEdition === 'Custom' ? kodiCustomEdition : kodiEdition || undefined,
          isExtrasDisc: kodiIsExtrasDisc || undefined,
          setName: kodiSetName || undefined,
          setOverview: kodiSetOverview || undefined,
          soundVersion: soundVersion === 'Custom' ? customSoundVersion : soundVersion || undefined,
          discNumber: parseInt(discNumber) || undefined,
          totalDiscs: parseInt(totalDiscs) || undefined
        } : undefined
      })

      if (result?.jobId) {
        addJob({
          jobId: result.jobId,
          dbId: result.dbId,
          type: enabledModes[0] || 'mkv_rip',
          status: 'running',
          percentage: 0,
          message: 'Disc drive spinning up...',
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
      <h1 className="text-2xl font-bold text-purple-400">Rip Disc</h1>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <DiscInfoCard onRescan={rescanDisc} />
          <TrackSelector
            isLibraryMode={modes.kodi_export || modes.jellyfin_export || modes.plex_export}
            movieTitle={kodiTitle}
          />
        </div>

        <div className="space-y-4">
          <RipModesPanel
            modes={modes}
            onModesChange={setModes}
            convertSubsToSrt={convertSubsToSrt}
            onConvertSubsToSrtChange={setConvertSubsToSrt}
            outputPaths={outputPaths}
            onOutputPathChange={setOutputPath}
          />
          {(modes.kodi_export || modes.jellyfin_export || modes.plex_export) && (
            <KodiOptionsPanel
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
              convertSubsToSrt={convertSubsToSrt}
              onConvertSubsToSrtChange={setConvertSubsToSrt}
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
