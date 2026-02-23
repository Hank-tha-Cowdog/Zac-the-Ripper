import { useCallback } from 'react'
import { useSettings } from './useSettings'
import { useDiscStore, type DiscSessionState } from '../stores/disc-store'

/**
 * Bridges SQLite-persisted settings with Zustand disc-session state.
 *
 * Persistent values (survive navigation + restart):
 *   modes, preserveInterlaced, convertSubsToSrt, outputPaths,
 *   kodiMediaType, kodiEdition, kodiCustomEdition, kodiIsExtrasDisc
 *
 * Disc-session values (reset when disc changes):
 *   kodiTitle, kodiYear, kodiTmdbId, kodiSetName, kodiSetOverview
 */
export function useRipSettings() {
  const { settings, saveSetting } = useSettings()
  const discSession = useDiscStore((s) => s.discSession)
  const updateDiscSession = useDiscStore((s) => s.updateDiscSession)

  // --- Persistent: modes ---
  const modes: Record<string, boolean> = {
    mkv_rip: settings['general.mode_mkv_rip'] === 'true',
    raw_capture: settings['general.mode_raw_capture'] === 'true',
    ffv1_archival: settings['general.mode_ffv1_archival'] === 'true',
    streaming_encode: settings['general.mode_streaming_encode'] === 'true',
    kodi_export: settings['general.mode_kodi_export'] === 'true',
    jellyfin_export: settings['general.mode_jellyfin_export'] === 'true',
    plex_export: settings['general.mode_plex_export'] === 'true'
  }

  const setModes = useCallback(
    (next: Record<string, boolean>) => {
      for (const [key, val] of Object.entries(next)) {
        const settingKey = `general.mode_${key}`
        if (settings[settingKey] !== String(val)) {
          saveSetting(settingKey, String(val))
        }
      }
    },
    [settings, saveSetting]
  )

  // --- Persistent: encoding toggles ---
  const preserveInterlaced = settings['encoding.preserve_interlaced'] === 'true'
  const setPreserveInterlaced = useCallback(
    (v: boolean) => saveSetting('encoding.preserve_interlaced', String(v)),
    [saveSetting]
  )

  const convertSubsToSrt = settings['encoding.convert_subs_to_srt'] === 'true'
  const setConvertSubsToSrt = useCallback(
    (v: boolean) => saveSetting('encoding.convert_subs_to_srt', String(v)),
    [saveSetting]
  )

  // --- Persistent: output paths (read from settings, write-through) ---
  const outputPaths: Record<string, string> = {
    mkv_rip: settings['paths.mkv_output'] || '',
    raw_capture: settings['paths.raw_output'] || '',
    ffv1_archival: settings['paths.ffv1_output'] || '',
    streaming_encode: settings['paths.streaming_output'] || '',
    kodi_export: settings['kodi.library_path'] || '',
    jellyfin_export: settings['jellyfin.library_path'] || '',
    plex_export: settings['plex.library_path'] || ''
  }

  const pathKeyMap: Record<string, string> = {
    mkv_rip: 'paths.mkv_output',
    raw_capture: 'paths.raw_output',
    ffv1_archival: 'paths.ffv1_output',
    streaming_encode: 'paths.streaming_output',
    kodi_export: 'kodi.library_path',
    jellyfin_export: 'jellyfin.library_path',
    plex_export: 'plex.library_path'
  }

  const setOutputPath = useCallback(
    (mode: string, path: string) => {
      const key = pathKeyMap[mode]
      if (key) saveSetting(key, path)
    },
    [saveSetting]
  )

  // --- Persistent: Kodi preferences (survive disc changes) ---
  const kodiMediaType = settings['rip.kodi_media_type'] || 'movie'
  const setKodiMediaType = useCallback(
    (v: string) => saveSetting('rip.kodi_media_type', v),
    [saveSetting]
  )

  const kodiEdition = settings['rip.kodi_edition'] || ''
  const setKodiEdition = useCallback(
    (v: string) => saveSetting('rip.kodi_edition', v),
    [saveSetting]
  )

  const kodiCustomEdition = settings['rip.kodi_custom_edition'] || ''
  const setKodiCustomEdition = useCallback(
    (v: string) => saveSetting('rip.kodi_custom_edition', v),
    [saveSetting]
  )

  const kodiIsExtrasDisc = settings['rip.kodi_extras_disc'] === 'true'
  const setKodiIsExtrasDisc = useCallback(
    (v: boolean) => saveSetting('rip.kodi_extras_disc', String(v)),
    [saveSetting]
  )

  // --- Disc-session (ephemeral, stored in Zustand) ---
  const setKodiTitle = useCallback(
    (v: string) => updateDiscSession({ kodiTitle: v }),
    [updateDiscSession]
  )
  const setKodiYear = useCallback(
    (v: string) => updateDiscSession({ kodiYear: v }),
    [updateDiscSession]
  )
  const setKodiTmdbId = useCallback(
    (v: number | null) => updateDiscSession({ kodiTmdbId: v }),
    [updateDiscSession]
  )
  const setKodiSetName = useCallback(
    (v: string) => {
      updateDiscSession({ kodiSetName: v })
      // Also persist collection name independently so it survives disc changes
      saveSetting('rip.collection_name', v)
    },
    [updateDiscSession, saveSetting]
  )
  const setKodiSetOverview = useCallback(
    (v: string) => updateDiscSession({ kodiSetOverview: v }),
    [updateDiscSession]
  )

  // --- Persistent: sound version + disc number ---
  const soundVersion = settings['rip.sound_version'] || ''
  const setSoundVersion = useCallback(
    (v: string) => saveSetting('rip.sound_version', v),
    [saveSetting]
  )

  const customSoundVersion = settings['rip.custom_sound_version'] || ''
  const setCustomSoundVersion = useCallback(
    (v: string) => saveSetting('rip.custom_sound_version', v),
    [saveSetting]
  )

  const discNumber = settings['rip.disc_number'] || ''
  const setDiscNumber = useCallback(
    (v: string) => saveSetting('rip.disc_number', v),
    [saveSetting]
  )

  const totalDiscs = settings['rip.total_discs'] || ''
  const setTotalDiscs = useCallback(
    (v: string) => saveSetting('rip.total_discs', v),
    [saveSetting]
  )

  // --- Persistent: TV show settings ---
  const tvSeason = settings['rip.tv_season'] || '1'
  const setTvSeason = useCallback(
    (v: string) => saveSetting('rip.tv_season', v),
    [saveSetting]
  )

  const tvStartEpisode = settings['rip.tv_start_episode'] || '1'
  const setTvStartEpisode = useCallback(
    (v: string) => saveSetting('rip.tv_start_episode', v),
    [saveSetting]
  )

  // --- Persistent: collection name (independent, survives disc changes until manually cleared) ---
  const persistedCollectionName = settings['rip.collection_name'] || ''

  // --- Persistent: library context (survives disc changes for multi-disc workflows) ---
  const libraryTitle = settings['rip.library_title'] || ''
  const libraryYear = settings['rip.library_year'] || ''
  const libraryTmdbId = settings['rip.library_tmdb_id'] || ''
  const librarySetName = settings['rip.library_set_name'] || ''
  const librarySetOverview = settings['rip.library_set_overview'] || ''
  const libraryPosterPath = settings['rip.library_poster_path'] || ''

  const saveLibraryContext = useCallback(
    (ctx: { title: string; year: string; tmdbId: string; setName: string; setOverview: string; posterPath: string }) => {
      saveSetting('rip.library_title', ctx.title)
      saveSetting('rip.library_year', ctx.year)
      saveSetting('rip.library_tmdb_id', ctx.tmdbId)
      saveSetting('rip.library_set_name', ctx.setName)
      saveSetting('rip.library_set_overview', ctx.setOverview)
      saveSetting('rip.library_poster_path', ctx.posterPath)
    },
    [saveSetting]
  )

  const clearLibraryContext = useCallback(() => {
    saveSetting('rip.library_title', '')
    saveSetting('rip.library_year', '')
    saveSetting('rip.library_tmdb_id', '')
    saveSetting('rip.library_set_name', '')
    saveSetting('rip.library_set_overview', '')
    saveSetting('rip.library_poster_path', '')
  }, [saveSetting])

  // --- Persistent: local file ingest ---
  const localIngestMode = settings['general.mode_local_ingest'] === 'true'
  const setLocalIngestMode = useCallback(
    (v: boolean) => saveSetting('general.mode_local_ingest', String(v)),
    [saveSetting]
  )

  return {
    // Persistent
    modes,
    setModes,
    preserveInterlaced,
    setPreserveInterlaced,
    convertSubsToSrt,
    setConvertSubsToSrt,
    outputPaths,
    setOutputPath,
    kodiMediaType,
    setKodiMediaType,
    kodiEdition,
    setKodiEdition,
    kodiCustomEdition,
    setKodiCustomEdition,
    kodiIsExtrasDisc,
    setKodiIsExtrasDisc,

    // TV show
    tvSeason,
    setTvSeason,
    tvStartEpisode,
    setTvStartEpisode,

    // Local ingest
    localIngestMode,
    setLocalIngestMode,

    // Collection name persistence
    persistedCollectionName,

    // Library context persistence
    libraryTitle,
    libraryYear,
    libraryTmdbId,
    librarySetName,
    librarySetOverview,
    libraryPosterPath,
    saveLibraryContext,
    clearLibraryContext,

    // Disc-session
    kodiTitle: discSession.kodiTitle,
    setKodiTitle,
    kodiYear: discSession.kodiYear,
    setKodiYear,
    kodiTmdbId: discSession.kodiTmdbId,
    setKodiTmdbId,
    kodiSetName: discSession.kodiSetName,
    setKodiSetName,
    kodiSetOverview: discSession.kodiSetOverview,
    setKodiSetOverview,
    soundVersion,
    setSoundVersion,
    customSoundVersion,
    setCustomSoundVersion,
    discNumber,
    setDiscNumber,
    totalDiscs,
    setTotalDiscs
  }
}
