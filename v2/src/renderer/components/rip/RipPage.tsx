import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DiscInfoCard } from './DiscInfoCard'
import { DiscSetSelector } from './DiscSetSelector'
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
  const { discInfo, selectedTracks, selectedDrive, setTmdbResult, updateDiscSession } = useDiscStore()
  const { addJob } = useJobsStore()
  const [isRipping, setIsRipping] = useState(false)
  const [standbyMessage, setStandbyMessage] = useState<string | null>(null)

  // One-shot scan + auto-load disc info if not already loaded from Dashboard
  useDiscDetection({ pollInterval: 0, autoLoadDiscInfo: true })

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
    discSetId, discNumber, setDiscSetId
  } = useRipSettings()

  const handleLibrarySelect = (selection: LibrarySelection) => {
    const { movie, setName, setOverview } = selection
    setKodiTitle(movie.title)
    if (movie.year) setKodiYear(String(movie.year))
    if (setName) setKodiSetName(setName)
    if (setOverview) setKodiSetOverview(setOverview)
  }

  const handleRip = async () => {
    if (selectedDrive === null || selectedTracks.length === 0) return

    setIsRipping(true)
    setStandbyMessage('Standby — your disc drive is coming up to speed')

    const enabledModes = Object.entries(modes).filter(([, v]) => v).map(([k]) => k)
    const outputDir = outputPaths.mkv_rip || ''

    try {
      const result = await window.ztr.rip.start({
        discIndex: selectedDrive,
        titleIds: selectedTracks,
        outputDir,
        modes: enabledModes,
        preserveInterlaced,
        convertSubsToSrt,
        kodiOptions: modes.kodi_export ? {
          mediaType: kodiMediaType,
          title: kodiTitle,
          year: kodiYear,
          tmdbId: kodiTmdbId,
          edition: kodiEdition === 'Custom' ? kodiCustomEdition : kodiEdition || undefined,
          isExtrasDisc: kodiIsExtrasDisc || undefined,
          setName: kodiSetName || undefined,
          setOverview: kodiSetOverview || undefined
        } : undefined,
        discSetId: discSetId || undefined,
        discNumber: discNumber || undefined
      })

      if (result?.jobId) {
        addJob({
          jobId: result.jobId,
          dbId: result.dbId,
          type: enabledModes[0] || 'mkv_rip',
          status: 'running',
          percentage: 0,
          message: 'Disc drive spinning up...'
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
          <DiscInfoCard />
          <TrackSelector />
        </div>

        <div className="space-y-4">
          <DiscSetSelector
            selectedSetId={discSetId}
            discNumber={discNumber}
            onSelectSet={(id, num) => setDiscSetId(id, num)}
          />
          <RipModesPanel
            modes={modes}
            onModesChange={setModes}
            preserveInterlaced={preserveInterlaced}
            onPreserveInterlacedChange={setPreserveInterlaced}
            convertSubsToSrt={convertSubsToSrt}
            onConvertSubsToSrtChange={setConvertSubsToSrt}
            outputPaths={outputPaths}
            onOutputPathChange={setOutputPath}
          />
          {modes.kodi_export && (
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
              convertSubsToSrt={convertSubsToSrt}
              onConvertSubsToSrtChange={setConvertSubsToSrt}
            />
          )}
        </div>
      </div>

      <RipActionBar
        modes={modes}
        onRip={handleRip}
        isRipping={isRipping}
        standbyMessage={standbyMessage}
      />
    </div>
  )
}
