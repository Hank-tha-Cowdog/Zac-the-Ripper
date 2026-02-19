import { BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { tmpdir, homedir } from 'os'
import { join, dirname } from 'path'
import { mkdirSync, rmSync, copyFileSync, existsSync } from 'fs'
import { MakeMKVService } from './makemkv'
import { FFmpegService } from './ffmpeg'
import { FFmpegRipperService } from './ffmpeg-ripper'
import { FFprobeService } from './ffprobe'
import { KodiOutputService, EXTRAS_FOLDER_MAP } from './kodi-output'
import { TMDBService } from './tmdb'
import { CDRipperService } from './cd-ripper'
import { MusicBrainzService } from './musicbrainz'
import type { DiscInfo } from './disc-detection'
import type { ReadError } from './makemkv'
import * as jobQueries from '../database/queries/jobs'
import * as discQueries from '../database/queries/discs'
import * as outputFileQueries from '../database/queries/output-files'
import { getSetting } from '../database/queries/settings'
import { getEncodingArgs } from '../encoding-presets'
import { createLogger } from '../util/logger'
import { IPC } from '../../shared/ipc-channels'
import { notifyJobComplete, notifyJobFailed } from './notify'
import { getDiscDetectionService } from './disc-detection'

const log = createLogger('job-queue')

/** Expand leading ~ to the user's home directory */
function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1))
  }
  return p
}

interface QueuedJob {
  id: string
  dbId: number
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
}

export class JobQueueService {
  private static instance: JobQueueService
  private queue: QueuedJob[] = []
  private ffmpegService = new FFmpegService()
  private ffmpegRipperService = new FFmpegRipperService()
  private ffprobeService = new FFprobeService()
  private kodiService = new KodiOutputService()
  private tmdbService = new TMDBService()
  private cdRipperService = new CDRipperService()
  private musicBrainzService = new MusicBrainzService()
  private processing = false

  static getInstance(): JobQueueService {
    if (!this.instance) {
      this.instance = new JobQueueService()
    }
    return this.instance
  }

  async createRipJob(params: {
    discIndex: number
    titleIds: number[]
    outputDir: string
    modes: string[]
    preserveInterlaced: boolean
    convertSubsToSrt: boolean
    trackMeta?: Array<{ titleId: number; category: string; name: string }>
    kodiOptions?: unknown
    discSetId?: number
    discNumber?: number
    isIngest?: boolean
    ingestFiles?: string[]
    window: BrowserWindow
    makemkvService: MakeMKVService
  }): Promise<{ jobId: string; dbId: number }> {
    const { discIndex, titleIds, modes, window, makemkvService, discSetId, discNumber } = params
    const outputDir = expandPath(params.outputDir)

    // Create disc record
    const discInfo = await getDiscDetectionService().getDiscInfo(discIndex)
    const disc = discQueries.createDisc({
      title: discInfo?.title || `Disc ${discIndex}`,
      disc_type: discInfo?.discType || 'DVD',
      disc_id: discInfo?.discId,
      track_count: discInfo?.trackCount || titleIds.length,
      metadata: JSON.stringify(discInfo || {}),
      disc_set_id: discSetId,
      disc_number: discNumber
    })

    // ── Media library export: full pipeline — extract → encode → organize ────
    // Jellyfin, Plex, and Kodi all use identical folder structure and NFO format
    const isJellyfin = modes.includes('jellyfin_export')
    const isPlex = modes.includes('plex_export')
    const isKodi = modes.includes('kodi_export')

    if (isJellyfin || isPlex || isKodi) {
      // Collect all enabled library paths in priority order
      const libraryTargets: Array<{ type: string; path: string }> = []
      if (isJellyfin) libraryTargets.push({ type: 'jellyfin_export', path: expandPath(getSetting('jellyfin.library_path') || '') })
      if (isPlex) libraryTargets.push({ type: 'plex_export', path: expandPath(getSetting('plex.library_path') || '') })
      if (isKodi) libraryTargets.push({ type: 'kodi_export', path: expandPath(getSetting('kodi.library_path') || '') })

      // Primary target: first enabled library; additional targets get copies
      const primaryType = libraryTargets[0].type
      const primaryPath = libraryTargets[0].path
      const additionalPaths = libraryTargets.slice(1).map(t => t.path).filter(Boolean)

      const dbJobType = primaryType as 'kodi_export' | 'jellyfin_export' | 'plex_export'
      const kodiOpts = params.kodiOptions as { title?: string } | undefined

      const job = jobQueries.createJob({
        disc_id: disc.id,
        job_type: dbJobType,
        output_path: primaryPath || outputDir,
        movie_title: kodiOpts?.title || null
      })

      const jobId = randomUUID()
      this.queue.push({ id: jobId, dbId: job.id, type: primaryType, status: 'pending' })

      log.info(`[media-lib] Created ${primaryType} job ${jobId} — library=${primaryPath}` +
        (additionalPaths.length > 0 ? `, additional=[${additionalPaths.join(', ')}]` : ''))

      this.executeMediaLibraryPipeline(jobId, job.id, {
        discIndex,
        titleIds,
        outputDir,
        window,
        makemkvService,
        modes,
        preserveInterlaced: params.preserveInterlaced,
        convertSubsToSrt: params.convertSubsToSrt,
        trackMeta: params.trackMeta,
        kodiOptions: params.kodiOptions,
        discId: disc.id,
        primaryLibraryPath: primaryPath,
        additionalLibraryPaths: additionalPaths,
        discSetId,
        discNumber,
        discInfo: discInfo || undefined,
        isIngest: params.isIngest,
        ingestFiles: params.ingestFiles
      })

      return { jobId, dbId: job.id }
    }

    // Extract user-entered title for all job types
    const kodiOpts = params.kodiOptions as { title?: string } | undefined

    // Create MKV rip job if mkv_rip mode is enabled
    if (modes.includes('mkv_rip')) {
      const mkvJob = jobQueries.createJob({
        disc_id: disc.id,
        job_type: 'mkv_rip',
        output_path: outputDir,
        movie_title: kodiOpts?.title || null
      })

      const jobId = randomUUID()
      this.queue.push({ id: jobId, dbId: mkvJob.id, type: 'mkv_rip', status: 'pending' })

      // Start ripping immediately
      this.executeRipJob(jobId, mkvJob.id, {
        discIndex,
        titleIds,
        outputDir,
        window,
        makemkvService,
        modes,
        preserveInterlaced: params.preserveInterlaced,
        convertSubsToSrt: params.convertSubsToSrt,
        kodiOptions: params.kodiOptions,
        discId: disc.id,
        discInfo: discInfo || undefined
      })

      return { jobId, dbId: mkvJob.id }
    }

    // Raw capture mode
    if (modes.includes('raw_capture')) {
      const rawJob = jobQueries.createJob({
        disc_id: disc.id,
        job_type: 'raw_capture',
        output_path: outputDir,
        movie_title: kodiOpts?.title || null
      })

      const jobId = randomUUID()
      this.queue.push({ id: jobId, dbId: rawJob.id, type: 'raw_capture', status: 'pending' })

      this.executeBackupJob(jobId, rawJob.id, {
        discIndex,
        outputDir,
        window,
        makemkvService
      })

      return { jobId, dbId: rawJob.id }
    }

    return { jobId: '', dbId: 0 }
  }

  async createEncodeJob(params: {
    inputPath: string
    outputDir: string
    preset: string
    preserveInterlaced: boolean
    convertSubsToSrt: boolean
    window: BrowserWindow
  }): Promise<{ jobId: string; dbId: number }> {
    const { inputPath, outputDir, preset, window } = params

    const jobType = preset === 'ffv1' ? 'ffv1_encode' : preset === 'hevc' ? 'hevc_encode' : 'h264_encode'
    const job = jobQueries.createJob({
      job_type: jobType,
      input_path: inputPath,
      output_path: outputDir,
      encoding_preset: preset
    })

    const jobId = randomUUID()
    this.queue.push({ id: jobId, dbId: job.id, type: job.job_type, status: 'pending' })

    this.executeEncodeJob(jobId, job.id, { ...params })

    return { jobId, dbId: job.id }
  }

  private async executeRipJob(jobId: string, dbId: number, params: {
    discIndex: number
    titleIds: number[]
    outputDir: string
    window: BrowserWindow
    makemkvService: MakeMKVService
    modes: string[]
    preserveInterlaced: boolean
    convertSubsToSrt: boolean
    kodiOptions?: unknown
    discId: number
    discInfo?: DiscInfo
  }): Promise<void> {
    const { discIndex, titleIds, outputDir, window, makemkvService, modes } = params

    jobQueries.updateJobStatus(dbId, 'running')
    this.updateQueueItem(jobId, 'running')
    getDiscDetectionService().rippingInProgress = true

    try {
      const result = await makemkvService.ripTitles({
        jobId,
        discIndex,
        titleIds,
        outputDir,
        window
      })

      if (result.success) {
        jobQueries.updateJobStatus(dbId, 'completed')
        this.updateQueueItem(jobId, 'completed')

        // Record output files
        for (const filePath of result.outputFiles) {
          outputFileQueries.createOutputFile({
            job_id: dbId,
            file_path: filePath,
            format: 'mkv'
          })
        }

        // Build read error summary for UI
        const readErrorSummary = this.buildReadErrorSummary(result.readErrors)

        window.webContents.send(IPC.RIP_COMPLETE, {
          jobId,
          outputFiles: result.outputFiles,
          readErrors: result.readErrors,
          readErrorSummary
        })
        const notifyMsg = readErrorSummary
          ? `MKV Rip (with ${result.readErrors?.length} read errors)`
          : 'MKV Rip'
        notifyJobComplete(notifyMsg, result.outputFiles[0]).catch(() => {})

        // Queue follow-up encoding jobs
        for (const filePath of result.outputFiles) {
          if (modes.includes('ffv1_archival')) {
            await this.createEncodeJob({
              inputPath: filePath,
              outputDir: expandPath(getSetting('paths.ffv1_output') || outputDir),
              preset: 'ffv1',
              preserveInterlaced: params.preserveInterlaced,
              convertSubsToSrt: params.convertSubsToSrt,
              window
            })
          }
          if (modes.includes('streaming_encode') || modes.includes('h264_streaming')) {
            const codec = getSetting('encoding.codec') || 'h264'
            const preset = codec === 'hevc' ? 'hevc' : 'h264'
            await this.createEncodeJob({
              inputPath: filePath,
              outputDir: expandPath(getSetting('paths.streaming_output') || getSetting('paths.h264_output') || outputDir),
              preset,
              preserveInterlaced: params.preserveInterlaced,
              convertSubsToSrt: params.convertSubsToSrt,
              window
            })
          }
        }
      } else {
        // MakeMKV failed — try ffmpeg VOB fallback for DVDs
        if (params.discInfo?.discType === 'DVD' && params.discInfo?.tracks?.length > 0) {
          log.info(`[rip] MakeMKV failed — attempting ffmpeg VOB fallback for DVD`)
          window.webContents.send(IPC.RIP_PROGRESS, {
            jobId, percentage: 5,
            message: 'MakeMKV failed, trying ffmpeg VOB fallback...'
          })

          const fallbackResult = await this.ffmpegRipperService.ripTitlesFromVOB({
            jobId, discInfo: params.discInfo, titleIds,
            outputDir, window,
            onProgress: (pct, message) => {
              window.webContents.send(IPC.RIP_PROGRESS, {
                jobId, percentage: pct,
                message: `Extracting (ffmpeg): ${pct.toFixed(0)}%`
              })
            }
          })

          if (fallbackResult.success && fallbackResult.outputFiles.length > 0) {
            log.info(`[rip] FFmpeg fallback succeeded — ${fallbackResult.outputFiles.length} file(s)`)
            jobQueries.updateJobStatus(dbId, 'completed')
            this.updateQueueItem(jobId, 'completed')

            for (const filePath of fallbackResult.outputFiles) {
              outputFileQueries.createOutputFile({ job_id: dbId, file_path: filePath, format: 'mkv' })
            }

            window.webContents.send(IPC.RIP_COMPLETE, {
              jobId, outputFiles: fallbackResult.outputFiles,
              readErrorSummary: 'Ripped via ffmpeg VOB fallback (MakeMKV failed)'
            })
            notifyJobComplete('MKV Rip (ffmpeg fallback)', fallbackResult.outputFiles[0]).catch(() => {})

            // Queue follow-up encoding jobs
            for (const filePath of fallbackResult.outputFiles) {
              if (modes.includes('ffv1_archival')) {
                await this.createEncodeJob({
                  inputPath: filePath,
                  outputDir: expandPath(getSetting('paths.ffv1_output') || outputDir),
                  preset: 'ffv1', preserveInterlaced: params.preserveInterlaced,
                  convertSubsToSrt: params.convertSubsToSrt, window
                })
              }
              if (modes.includes('streaming_encode') || modes.includes('h264_streaming')) {
                const codec = getSetting('encoding.codec') || 'h264'
                const preset = codec === 'hevc' ? 'hevc' : 'h264'
                await this.createEncodeJob({
                  inputPath: filePath,
                  outputDir: expandPath(getSetting('paths.streaming_output') || getSetting('paths.h264_output') || outputDir),
                  preset, preserveInterlaced: params.preserveInterlaced,
                  convertSubsToSrt: params.convertSubsToSrt, window
                })
              }
            }
          } else {
            jobQueries.updateJobStatus(dbId, 'failed', { error_message: fallbackResult.error || 'Both MakeMKV and ffmpeg VOB fallback failed' })
            this.updateQueueItem(jobId, 'failed')
            window.webContents.send(IPC.RIP_ERROR, { jobId, error: fallbackResult.error || 'Both MakeMKV and ffmpeg VOB fallback failed' })
            notifyJobFailed('MKV Rip', fallbackResult.error || 'Both MakeMKV and ffmpeg fallback failed').catch(() => {})
          }
        } else {
          jobQueries.updateJobStatus(dbId, 'failed', { error_message: result.error })
          this.updateQueueItem(jobId, 'failed')
          window.webContents.send(IPC.RIP_ERROR, { jobId, error: result.error })
          notifyJobFailed('MKV Rip', result.error).catch(() => {})
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      jobQueries.updateJobStatus(dbId, 'failed', { error_message: msg })
      this.updateQueueItem(jobId, 'failed')
      window.webContents.send(IPC.RIP_ERROR, { jobId, error: msg })
      notifyJobFailed('MKV Rip', msg).catch(() => {})
    } finally {
      getDiscDetectionService().rippingInProgress = false
    }
  }

  /**
   * Media library export pipeline — disc extraction → HEVC encoding → library organization.
   * Works for both Jellyfin and Kodi (identical folder structure and NFO format).
   *
   * Architecture:
   *   Disc → MakeMKV → temp staging MKV → FFmpeg encode → primary library
   *   (optional) → copy to secondary library
   *
   * MakeMKV extracts the MKV to a temp staging directory. After extraction
   * completes, FFmpeg encodes HEVC and writes to the final library directory.
   * TMDB metadata and artwork are fetched concurrently during extraction.
   * If a secondary library path is provided (dual Jellyfin + Kodi), the
   * encoded file, NFO, and artwork are copied to it after primary finalization.
   */
  private async executeMediaLibraryPipeline(jobId: string, dbId: number, params: {
    discIndex: number
    titleIds: number[]
    outputDir: string
    window: BrowserWindow
    makemkvService: MakeMKVService
    modes: string[]
    preserveInterlaced: boolean
    convertSubsToSrt: boolean
    trackMeta?: Array<{ titleId: number; category: string; name: string }>
    kodiOptions?: unknown
    discId: number
    primaryLibraryPath: string
    additionalLibraryPaths?: string[]
    discSetId?: number
    discNumber?: number
    discInfo?: DiscInfo
    isIngest?: boolean
    ingestFiles?: string[]
  }): Promise<void> {
    const { discIndex, titleIds, window, makemkvService, modes } = params
    const opts = params.kodiOptions as {
      mediaType?: string; title?: string; year?: string; tmdbId?: number
      edition?: string; isExtrasDisc?: boolean; setName?: string; setOverview?: string
      soundVersion?: string; discNumber?: number; totalDiscs?: number
      customPlot?: string; customActors?: string[]; customPosterPath?: string
      tvOptions?: {
        showName: string; year: string; season: number
        episodes: Array<{ trackId: number; episodeNumber: number; episodeTitle: string }>
      }
    } | undefined

    const primaryLibraryPath = params.primaryLibraryPath
    const movieTitle = opts?.title || 'Unknown'
    const movieYear = parseInt(opts?.year || '') || new Date().getFullYear()

    jobQueries.updateJobStatus(dbId, 'running')
    this.updateQueueItem(jobId, 'running')

    // ── Create temp staging directory for intermediate MKV ─────────
    const stagingDir = join(tmpdir(), `ztr_stage_${jobId.slice(0, 8)}`)
    mkdirSync(stagingDir, { recursive: true })
    log.info(`[media-lib] Staging dir: ${stagingDir}`)

    // Progress state — pipeline manages its own unified progress
    // Weighted steps: Rip 0-50%, Encode 50-90%, Kodi org 90-100%
    let ripPct = 0
    let encodePct = 0
    let encodeSpeed: number | null = null
    let phase: 'rip' | 'encode' | 'encode-finishing' | 'kodi-org' | 'done' = 'rip'

    const sendProgress = (pct: number, message: string) => {
      window.webContents.send(IPC.RIP_PROGRESS, { jobId, percentage: pct, message })
    }

    try {
      // ── Determine final library output paths ──────────────────────
      if (!primaryLibraryPath) throw new Error('Library path not configured — set it in Settings > Jellyfin or Settings > Kodi')

      // TV shows use a completely different folder structure — skip movie path setup
      const isTVShow = opts?.mediaType === 'tvshow' && opts?.tvOptions

      // When isExtrasDisc is true, ALL tracks are extras — override any 'main' category
      // in trackMeta so nothing gets written to the main movie directory.
      const trackMetaOverridden = (opts?.isExtrasDisc && params.trackMeta)
        ? params.trackMeta.map(m => m.category === 'main'
          ? { ...m, category: 'featurette' }
          : m)
        : params.trackMeta
      const hasTrackMeta = trackMetaOverridden && trackMetaOverridden.length > 0
      const hasMainTrack = hasTrackMeta && trackMetaOverridden!.some(m => m.category === 'main')
      const useExtrasDiscMode = opts?.isExtrasDisc && !hasTrackMeta

      // Movie path setup — only for movies, TV shows handle their own paths later
      let movieRootDir = ''
      let finalVideoPath = ''
      let libraryOutputDir = ''
      let skipMainEncode = false

      if (!isTVShow) {
        // Always compute the movie root dir (Movies/Title (Year)/) — extras subfolders go here
        const movieRoot = this.kodiService.buildMoviePath({
          libraryPath: primaryLibraryPath,
          title: movieTitle,
          year: movieYear
        })
        movieRootDir = movieRoot.outputDir

        // Compute main feature path (may not be used if all tracks are extras)
        const movieMain = this.kodiService.buildMoviePath({
          libraryPath: primaryLibraryPath,
          title: movieTitle,
          year: movieYear,
          edition: opts?.edition,
          soundVersion: opts?.soundVersion,
          discNumber: opts?.discNumber,
          totalDiscs: opts?.totalDiscs,
          isExtrasDisc: useExtrasDiscMode
        })
        finalVideoPath = movieMain.videoPath
        libraryOutputDir = movieMain.outputDir

        // Skip main feature encode if trackMeta exists but has no 'main' category
        skipMainEncode = hasTrackMeta && !hasMainTrack

        mkdirSync(movieRootDir, { recursive: true })
        if (!skipMainEncode) mkdirSync(libraryOutputDir, { recursive: true })
        log.info(`[media-lib] Movie root dir: ${movieRootDir}`)
        log.info(`[media-lib] Output dir: ${libraryOutputDir}`)
        log.info(`[media-lib] Final video path: ${finalVideoPath} (skipMainEncode=${skipMainEncode})`)
      } else {
        log.info(`[media-lib] TV show mode — skipping movie path setup`)
      }

      // ── Fetch TMDB metadata + artwork concurrently with rip ─────
      let tmdbDetails: Awaited<ReturnType<TMDBService['getDetails']>> = null
      let posterLocalPath: string | undefined
      let fanartLocalPath: string | undefined

      const tmdbPromise = (async () => {
        if (!opts?.tmdbId) return
        try {
          tmdbDetails = await this.tmdbService.getDetails(opts.tmdbId, opts.mediaType || 'movie')
          log.info(`[media-lib] TMDB details fetched: "${tmdbDetails?.title}" (${tmdbDetails?.imdb_id || 'no IMDB'})`)

          if (tmdbDetails?.poster_path) {
            const dest = join(tmpdir(), `ztr_poster_${opts.tmdbId}.jpg`)
            const dl = await this.tmdbService.downloadArtwork(tmdbDetails.poster_path, dest)
            if (dl.success) posterLocalPath = dest
          }
          if (tmdbDetails?.backdrop_path) {
            const dest = join(tmpdir(), `ztr_fanart_${opts.tmdbId}.jpg`)
            const dl = await this.tmdbService.downloadArtwork(tmdbDetails.backdrop_path, dest)
            if (dl.success) fanartLocalPath = dest
          }
        } catch (err) {
          log.warn(`[media-lib] TMDB fetch failed (non-fatal): ${err}`)
        }
      })()

      // ── Determine encoding preset ──
      const codec = getSetting('encoding.codec') || 'h264'
      const preset = codec === 'hevc' ? 'hevc' : 'h264'
      log.info(`[media-lib] Codec preset: ${preset}`)

      // ── Step 1: Extract from disc (or use ingest files) ─────────────
      let extractResult: { success: boolean; outputFiles: string[]; error?: string; readErrors?: ReadError[] }

      if (params.isIngest && params.ingestFiles && params.ingestFiles.length > 0) {
        // Ingest mode: skip disc extraction, use local files directly
        log.info(`[media-lib] Ingest mode — using ${params.ingestFiles.length} local file(s)`)
        sendProgress(0, 'Step 1/3 — Using local files (no disc extraction)...')

        // Copy ingest files to staging dir so the rest of the pipeline works the same
        for (const ingestFile of params.ingestFiles) {
          const destPath = join(stagingDir, ingestFile.split('/').pop() || 'input.mkv')
          try {
            copyFileSync(ingestFile, destPath)
          } catch (err) {
            log.warn(`[media-lib] Failed to copy ingest file: ${err}`)
          }
        }

        const stagedFiles = params.ingestFiles.map(f => join(stagingDir, f.split('/').pop() || 'input.mkv'))
        extractResult = { success: true, outputFiles: stagedFiles.filter(f => existsSync(f)) }

        if (extractResult.outputFiles.length === 0) {
          throw new Error('No valid ingest files found')
        }

        sendProgress(50, 'Step 1/3 — Local files ready')
        log.info(`[media-lib] Ingest: ${extractResult.outputFiles.length} file(s) staged`)
      } else {
        sendProgress(0, 'Step 1/3 — Starting disc extraction...')

        log.info(`[media-lib] Starting MakeMKV extraction: disc:${discIndex} titles=[${titleIds}] → ${stagingDir}`)
        getDiscDetectionService().rippingInProgress = true

        extractResult = await makemkvService.ripTitles({
          jobId,
          discIndex,
          titleIds,
          outputDir: stagingDir,
          window,
          onProgress: (pct, message) => {
            ripPct = pct
            if (phase === 'rip') {
              // Step 1/3: Rip maps to 0-50% of overall progress
              const overall = pct * 0.5
              sendProgress(overall, `Step 1/3 — Extracting from disc: ${pct.toFixed(0)}%`)
            }
          }
        })

        // Use partial MakeMKV results if any files were extracted (e.g., 3 of 4 episodes
        // succeeded but the "play all" title failed). Only fall back to FFmpeg if zero files.
        if (extractResult.outputFiles.length > 0 && !extractResult.success) {
          log.warn(`[media-lib] MakeMKV partially succeeded: ${extractResult.outputFiles.length} file(s) extracted. ${extractResult.error || 'Some titles failed.'}`)
          sendProgress(50, `Step 1/3 — Extracted ${extractResult.outputFiles.length} of ${titleIds.length} titles (partial)`)
        }

        if (extractResult.outputFiles.length === 0) {
          // MakeMKV produced no files — try ffmpeg VOB fallback for DVDs
          // Allow fallback when discInfo is missing (e.g. disc couldn't be read) — FFmpeg can
          // independently probe the VIDEO_TS structure. Only skip for confirmed non-DVD types.
          const isDVDOrUnknown = !params.discInfo || params.discInfo.discType === 'DVD'
          if (isDVDOrUnknown) {
            log.info(`[media-lib] MakeMKV failed — attempting ffmpeg VOB fallback` +
              (!params.discInfo ? ' (discInfo unavailable, assuming DVD)' : ''))
            sendProgress(5, 'Step 1/3 — MakeMKV failed, trying ffmpeg fallback...')

            // If discInfo is missing, build a minimal stub so FFmpeg ripper can detect the device
            const fallbackDiscInfo = params.discInfo || {
              discType: 'DVD' as const,
              tracks: [],
              title: 'Unknown',
              discId: undefined,
              trackCount: 0,
              metadata: { devicePath: `/dev/rdisk${discIndex}` }
            }

            extractResult = await this.ffmpegRipperService.ripTitlesFromVOB({
              jobId,
              discInfo: fallbackDiscInfo,
              titleIds,
              outputDir: stagingDir,
              window,
              onProgress: (pct, message) => {
                ripPct = pct
                if (phase === 'rip') {
                  sendProgress(pct * 0.5, `Step 1/3 — Extracting (ffmpeg): ${pct.toFixed(0)}%`)
                }
              }
            })

            if (!extractResult.success || extractResult.outputFiles.length === 0) {
              throw new Error(extractResult.error || 'Both MakeMKV and ffmpeg VOB fallback failed')
            }
            log.info(`[media-lib] FFmpeg fallback succeeded — ${extractResult.outputFiles.length} file(s)`)
          } else {
            throw new Error(extractResult.error || 'MKV extraction produced no files')
          }
        }

        // Release disc polling guard after entire extraction phase (MakeMKV + potential FFmpeg fallback)
        getDiscDetectionService().rippingInProgress = false

        log.info(`[media-lib] MakeMKV finished — ${extractResult.outputFiles.length} file(s) extracted` +
          (extractResult.readErrors?.length ? `, ${extractResult.readErrors.length} read error(s)` : ''))
      }

      // ── TV Show Pipeline Branch ─────────────────────────────────────
      if (isTVShow) {
        const tv = opts.tvOptions
        const showYear = parseInt(tv.year || '') || movieYear

        phase = 'encode'
        sendProgress(50, 'Step 2/3 — Encoding TV episodes...')

        // Wait for TMDB fetch
        await tmdbPromise

        // Use custom poster if provided
        if (opts.customPosterPath && existsSync(opts.customPosterPath) && !posterLocalPath) {
          posterLocalPath = opts.customPosterPath
        }

        // Build actors from custom or TMDB
        const tvActors = opts.customActors && opts.customActors.length > 0
          ? opts.customActors.map((name, i) => ({ name, role: '', order: i }))
          : tmdbDetails?.credits?.cast?.slice(0, 20)?.map((c: { name: string; character: string; order: number }, i: number) => ({
              name: c.name, role: c.character || '', order: c.order ?? i
            }))
          || undefined

        // Create show folder + tvshow.nfo
        this.kodiService.exportTVShow({
          libraryPath: primaryLibraryPath,
          showName: tv.showName,
          year: showYear,
          metadata: {
            plot: opts.customPlot || tmdbDetails?.overview || undefined,
            genres: tmdbDetails?.genres?.map(g => g.name),
            tmdb_id: opts.tmdbId,
            imdb_id: tmdbDetails?.imdb_id || undefined,
            actors: tvActors
          },
          artwork: { poster: posterLocalPath, fanart: fanartLocalPath }
        })

        // Encode + export each episode
        const allEpisodeFiles: string[] = []
        for (let ei = 0; ei < extractResult.outputFiles.length; ei++) {
          const stagingFile = extractResult.outputFiles[ei]
          const epInfo = tv.episodes[ei]
          if (!epInfo) continue

          const epCode = `S${String(tv.season).padStart(2, '0')}E${String(epInfo.episodeNumber).padStart(2, '0')}`
          const epTitle = epInfo.episodeTitle || `Episode ${epInfo.episodeNumber}`
          const showFolder = showYear ? `${tv.showName} (${showYear})` : tv.showName
          // Use showFolder (with year) in filename to match kodi-output.ts naming convention
          const baseName = `${showFolder} - ${epCode} - ${epTitle}`

          log.info(`[media-lib] Encoding TV episode ${ei + 1}/${extractResult.outputFiles.length}: ${baseName}`)

          const seasonDir = join(primaryLibraryPath, 'TV Shows', showFolder, `Season ${String(tv.season).padStart(2, '0')}`)
          mkdirSync(seasonDir, { recursive: true })
          // Encode to staging dir — exportTVEpisode will copy to final location
          const epStagingPath = join(stagingDir, `${baseName}.mkv`)

          try {
            const epMediaInfo = await this.ffprobeService.analyze(stagingFile)
            const epEncodeArgs = getEncodingArgs(preset, {
              mediaInfo: epMediaInfo,
              preserveInterlaced: params.preserveInterlaced,
              convertSubsToSrt: params.convertSubsToSrt
            })

            const epPct = (ei / extractResult.outputFiles.length)
            sendProgress(50 + epPct * 40, `Step 2/3 — Encoding ${epCode}: ${epTitle}`)

            const epEncodeResult = await this.ffmpegService.encode({
              jobId: `${jobId}_ep_${ei}`,
              inputPath: stagingFile,
              outputPath: epStagingPath,
              args: epEncodeArgs,
              totalDuration: epMediaInfo.duration,
              window,
              onProgress: (pct) => {
                sendProgress(50 + ((ei + pct / 100) / extractResult.outputFiles.length) * 40,
                  `Step 2/3 — Encoding ${epCode}: ${pct.toFixed(0)}%`)
              }
            })

            if (epEncodeResult.success) {
              // exportTVEpisode copies from staging to season dir and generates NFO
              const epExport = this.kodiService.exportTVEpisode({
                libraryPath: primaryLibraryPath,
                showName: showFolder,
                season: tv.season,
                episode: epInfo.episodeNumber,
                episodeTitle: epTitle,
                sourceFile: epStagingPath,
                metadata: {
                  tmdb_id: opts.tmdbId,
                  actors: tvActors
                }
              })

              allEpisodeFiles.push(epExport.episodePath)

              outputFileQueries.createOutputFile({
                job_id: dbId,
                file_path: epExport.episodePath,
                format: 'mkv',
                video_codec: preset === 'hevc' ? 'hevc' : 'h264'
              })
              log.info(`[media-lib] TV episode encoded: ${epExport.episodePath}`)
            } else {
              log.warn(`[media-lib] TV episode encode failed: ${epEncodeResult.error}`)
            }
          } catch (err) {
            log.warn(`[media-lib] TV episode encode crashed: ${err}`)
          }
        }

        // Copy to additional libraries
        if (params.additionalLibraryPaths) {
          for (const additionalPath of params.additionalLibraryPaths) {
            try {
              this.kodiService.exportTVShow({
                libraryPath: additionalPath,
                showName: tv.showName,
                year: showYear,
                metadata: { plot: opts.customPlot || tmdbDetails?.overview || undefined, tmdb_id: opts.tmdbId },
                artwork: { poster: posterLocalPath, fanart: fanartLocalPath }
              })
              const showFolder = showYear ? `${tv.showName} (${showYear})` : tv.showName
              for (const epFile of allEpisodeFiles) {
                const showDir = join(primaryLibraryPath, 'TV Shows', showFolder)
                const relPath = epFile.slice(showDir.length)
                const destDir = join(additionalPath, 'TV Shows', showFolder)
                const destPath = join(destDir, relPath)
                mkdirSync(dirname(destPath), { recursive: true })
                copyFileSync(epFile, destPath)
              }
            } catch (err) {
              log.warn(`[media-lib] TV show additional library copy failed: ${err}`)
            }
          }
        }

        // Clean up and finish
        try { rmSync(stagingDir, { recursive: true, force: true }) } catch {}

        phase = 'done'
        sendProgress(100, 'Complete')
        jobQueries.updateJobStatus(dbId, 'completed')
        this.updateQueueItem(jobId, 'completed')
        window.webContents.send(IPC.RIP_COMPLETE, { jobId, outputFiles: allEpisodeFiles })
        notifyJobComplete(`${tv.showName} S${String(tv.season).padStart(2, '0')}`, allEpisodeFiles[0]).catch(() => {})
        log.info(`[media-lib] TV pipeline complete — ${allEpisodeFiles.length} episode(s)`)
        return
      }

      // ── Build titleId → output file mapping ──────────────────────
      // MakeMKV rips titles sequentially. Output files correspond to
      // successful extractions in titleIds order. Build a reliable mapping
      // so we can match trackMeta entries (by titleId) to files.
      const titleFileMap = new Map<number, string>()
      {
        // MakeMKV names files as D{disc}_t{titleId}.mkv — parse titleId from filename
        const parseTitleId = (filePath: string): number | null => {
          const match = filePath.match(/[Dd]\d+_t(\d+)\.mkv$/)
          return match ? parseInt(match[1], 10) : null
        }

        for (const file of extractResult.outputFiles) {
          const parsed = parseTitleId(file)
          if (parsed !== null) {
            titleFileMap.set(parsed, file)
          }
        }

        // Fallback: if parsing failed (unusual naming), use sequential mapping
        if (titleFileMap.size === 0 && extractResult.outputFiles.length > 0) {
          log.warn(`[media-lib] Could not parse titleIds from filenames — using sequential mapping`)
          for (let i = 0; i < extractResult.outputFiles.length && i < titleIds.length; i++) {
            titleFileMap.set(titleIds[i], extractResult.outputFiles[i])
          }
        }
        log.info(`[media-lib] Title→file map: ${[...titleFileMap.entries()].map(([id, f]) => `t${id}→${f.split('/').pop()}`).join(', ')}`)
      }

      // ── Determine main feature vs extras from trackMeta ──────────
      const trackMetaList = trackMetaOverridden
      let mainTitleId: number | null = null
      let mainStagingPath: string | null = null

      if (trackMetaList && trackMetaList.length > 0) {
        const mainMeta = trackMetaList.find(m => m.category === 'main')
        if (mainMeta) {
          mainTitleId = mainMeta.titleId
          mainStagingPath = titleFileMap.get(mainMeta.titleId) || null
        }
      } else if (!skipMainEncode) {
        // No trackMeta — single-track rip, use first output file
        mainTitleId = titleIds[0]
        mainStagingPath = extractResult.outputFiles[0] || null
      }

      if (!skipMainEncode && !mainStagingPath) {
        // We expected a main track but don't have a file for it
        if (extractResult.outputFiles.length > 0) {
          // Fallback: use the first available output file
          mainStagingPath = extractResult.outputFiles[0]
          log.warn(`[media-lib] Main track file not found by titleId — falling back to first output file`)
        } else {
          throw new Error('No output files available for main feature encoding')
        }
      }

      // ── Step 2: Encode main feature (if applicable) ──────────────
      phase = 'encode'

      if (!skipMainEncode) {
        const stagingMkvPath = mainStagingPath!
        sendProgress(50, 'Step 2/3 — Analyzing extracted file...')

        let encodeResult: { success: boolean; error?: string }

        try {
          // Analyze the complete staging MKV with ffprobe
          const completeMediaInfo = await this.ffprobeService.analyze(stagingMkvPath)
          const v = completeMediaInfo.videoStreams[0]
          log.info(`[media-lib] ffprobe video: ${v?.codec} ${v?.width}x${v?.height} ` +
            `DAR=${v?.displayAspectRatio} ${v?.framerate}fps ` +
            `field=${v?.fieldOrder} ${v?.bitDepth}bit ${v?.pixelFormat} ` +
            `color=${v?.colorSpace}/${v?.colorPrimaries}/${v?.colorTransfer} range=${v?.colorRange}`)
          log.info(`[media-lib] ffprobe: ${completeMediaInfo.audioStreams.length} audio, ` +
            `${completeMediaInfo.subtitleStreams.length} subs, duration=${completeMediaInfo.duration.toFixed(1)}s`)

          // Build encoding args with accurate ffprobe data
          const encodeArgs = getEncodingArgs(preset, {
            mediaInfo: completeMediaInfo,
            preserveInterlaced: params.preserveInterlaced,
            convertSubsToSrt: params.convertSubsToSrt
          })
          log.info(`[media-lib] FFmpeg args: ${encodeArgs.join(' ')}`)

          encodeResult = await this.ffmpegService.encode({
            jobId,
            inputPath: stagingMkvPath,
            outputPath: finalVideoPath,
            args: encodeArgs,
            totalDuration: completeMediaInfo.duration,
            window,
            onProgress: (pct, speed) => {
              encodePct = pct
              encodeSpeed = speed
              // Step 2/3: Encode maps to 50-90% of overall progress
              const overall = 50 + (pct * 0.4)
              const speedStr = speed ? ` @ ${speed.toFixed(1)}x` : ''
              sendProgress(overall, `Step 2/3 — Encoding HEVC: ${pct.toFixed(0)}%${speedStr}`)
            }
          })

          if (encodeResult.success) {
            log.info(`[media-lib] Encode succeeded: ${finalVideoPath}`)
          } else {
            log.error(`[media-lib] Encode failed: ${encodeResult.error}`)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error(`[media-lib] Encode crashed: ${msg}`)
          encodeResult = { success: false, error: msg }
        }

        if (!encodeResult.success) {
          throw new Error(encodeResult.error || 'HEVC encoding failed')
        }

        log.info(`[media-lib] Encode complete: ${finalVideoPath}`)

        // Record output files in DB
        outputFileQueries.createOutputFile({
          job_id: dbId,
          file_path: finalVideoPath,
          format: 'mkv',
          video_codec: preset === 'hevc' ? 'hevc' : 'h264'
        })
      } else {
        log.info(`[media-lib] Skipping main feature encode — all tracks are extras`)
        sendProgress(50, 'Step 2/3 — Encoding extras...')
      }

      // ── Encode extras tracks ──────────────────────────────────────
      // Extras category subfolders (Featurettes/, Behind The Scenes/, etc.)
      // go at the movie root level — NOT inside an Extras/ subfolder.
      // Plex, Jellyfin, and Kodi all expect: Movies/Title (Year)/Featurettes/file.mkv
      const extrasOutputFiles: string[] = []
      if (trackMetaList && trackMetaList.length > 0 && titleFileMap.size > 0) {
        // Build extras list by matching trackMeta entries to output files via titleId
        const extrasEntries = trackMetaList
          .filter(meta => meta.category !== 'main' && meta.category !== 'episode')
          .map(meta => ({ meta, file: titleFileMap.get(meta.titleId) }))
          .filter((entry): entry is { meta: typeof trackMetaList[0]; file: string } => {
            if (!entry.file) {
              log.warn(`[media-lib] Extra "${entry.meta.name}" (title ${entry.meta.titleId}) — no output file found (extraction may have failed)`)
              return false
            }
            return true
          })

        for (let ei = 0; ei < extrasEntries.length; ei++) {
          const { meta: extraMeta, file: extrasFile } = extrasEntries[ei]
          const categoryFolder = EXTRAS_FOLDER_MAP[extraMeta.category] || 'Other'
          const extrasDir = join(movieRootDir, categoryFolder)
          mkdirSync(extrasDir, { recursive: true })

          // Sanitize filename
          const safeName = extraMeta.name.replace(/[<>:"/\\|?*]/g, '_').trim() || `Bonus ${String(ei + 1).padStart(3, '0')}`
          const extrasOutputPath = join(extrasDir, `${safeName}.mkv`)

          log.info(`[media-lib] Encoding extra ${ei + 1}/${extrasEntries.length}: "${extraMeta.name}" (${extraMeta.category}) → ${extrasOutputPath}`)
          sendProgress(90 + (ei / extrasEntries.length) * 2, `Step 2/3 — Encoding extra: ${extraMeta.name}`)

          try {
            const extrasMediaInfo = await this.ffprobeService.analyze(extrasFile)
            const extrasEncodeArgs = getEncodingArgs(preset, {
              mediaInfo: extrasMediaInfo,
              preserveInterlaced: params.preserveInterlaced,
              convertSubsToSrt: params.convertSubsToSrt
            })

            const extrasEncodeResult = await this.ffmpegService.encode({
              jobId: `${jobId}_extra_${ei}`,
              inputPath: extrasFile,
              outputPath: extrasOutputPath,
              args: extrasEncodeArgs,
              totalDuration: extrasMediaInfo.duration,
              window,
              onProgress: (pct) => {
                sendProgress(90 + ((ei + pct / 100) / extrasEntries.length) * 2,
                  `Step 2/3 — Encoding extra: ${extraMeta.name} ${pct.toFixed(0)}%`)
              }
            })

            if (extrasEncodeResult.success) {
              extrasOutputFiles.push(extrasOutputPath)
              log.info(`[media-lib] Extra encoded: ${extrasOutputPath}`)
            } else {
              log.warn(`[media-lib] Extra encode failed (non-fatal): ${extrasEncodeResult.error}`)
            }
          } catch (err) {
            log.warn(`[media-lib] Extra encode crashed (non-fatal): ${err}`)
          }
        }
      }

      // ── Finalize: NFO, artwork, library structure ─────────────────
      phase = 'kodi-org'
      sendProgress(92, 'Step 3/3 — Organizing library (NFO, artwork)...')

      // Wait for TMDB fetch to complete (likely already done)
      await tmdbPromise

      // Use custom poster if provided and no TMDB poster
      if (opts?.customPosterPath && existsSync(opts.customPosterPath)) {
        if (!posterLocalPath) {
          posterLocalPath = opts.customPosterPath
        }
      }

      // Build actors from custom or TMDB
      const actorsForNfo = opts?.customActors && opts.customActors.length > 0
        ? opts.customActors.map((name, i) => ({ name, role: '', order: i }))
        : tmdbDetails?.credits?.cast?.slice(0, 20)?.map((c: { name: string; character: string; order: number; profile_path?: string }, i: number) => ({
            name: c.name,
            role: c.character || '',
            order: c.order ?? i,
            thumb: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : undefined
          }))
        || undefined

      const finalizeParams = {
        libraryPath: primaryLibraryPath,
        title: movieTitle,
        year: movieYear,
        sourceFile: finalVideoPath,
        videoAlreadyAtPath: finalVideoPath,
        metadata: {
          tmdb_id: opts?.tmdbId,
          imdb_id: tmdbDetails?.imdb_id || undefined,
          plot: opts?.customPlot || tmdbDetails?.overview || undefined,
          tagline: tmdbDetails?.tagline || undefined,
          genres: tmdbDetails?.genres?.map(g => g.name),
          runtime: tmdbDetails?.runtime || undefined,
          voteAverage: tmdbDetails?.vote_average || undefined,
          actors: actorsForNfo
        },
        artwork: {
          poster: posterLocalPath,
          fanart: fanartLocalPath
        },
        edition: opts?.edition,
        isExtrasDisc: useExtrasDiscMode,
        setName: opts?.setName,
        setOverview: opts?.setOverview,
        discNumber: opts?.discNumber,
        totalDiscs: opts?.totalDiscs,
        soundVersion: opts?.soundVersion
      }

      if (!skipMainEncode) {
        this.kodiService.finalizeMovie(finalizeParams)
        log.info(`[media-lib] Primary library organized: ${primaryLibraryPath}`)
      }

      // ── Copy to additional libraries (Jellyfin + Plex + Kodi multi-output) ──
      if (params.additionalLibraryPaths && params.additionalLibraryPaths.length > 0) {
        sendProgress(95, `Step 3/3 — Copying to ${params.additionalLibraryPaths.length} additional librar${params.additionalLibraryPaths.length > 1 ? 'ies' : 'y'}...`)
        for (const additionalPath of params.additionalLibraryPaths) {
          try {
            const { outputDir: additionalMovieRoot } = this.kodiService.buildMoviePath({
              libraryPath: additionalPath,
              title: movieTitle,
              year: movieYear
            })
            mkdirSync(additionalMovieRoot, { recursive: true })

            // Copy main feature if applicable
            if (!skipMainEncode) {
              const { videoPath: additionalVideoPath } =
                this.kodiService.buildMoviePath({
                  libraryPath: additionalPath,
                  title: movieTitle,
                  year: movieYear,
                  edition: opts?.edition,
                  soundVersion: opts?.soundVersion,
                  discNumber: opts?.discNumber,
                  totalDiscs: opts?.totalDiscs,
                  isExtrasDisc: useExtrasDiscMode
                })
              mkdirSync(dirname(additionalVideoPath), { recursive: true })
              copyFileSync(finalVideoPath, additionalVideoPath)
              this.kodiService.finalizeMovie({
                ...finalizeParams,
                libraryPath: additionalPath,
                videoAlreadyAtPath: additionalVideoPath
              })
            }

            // Copy extras subfolders to additional library
            for (const extrasFile of extrasOutputFiles) {
              const relPath = extrasFile.slice(movieRootDir.length)
              const destPath = join(additionalMovieRoot, relPath)
              mkdirSync(dirname(destPath), { recursive: true })
              copyFileSync(extrasFile, destPath)
            }
            log.info(`[media-lib] Additional library organized: ${additionalPath}`)
          } catch (err) {
            log.warn(`[media-lib] Additional library copy failed (non-fatal): ${err}`)
          }
        }
      }

      // ── Clean up staging directory ──────────────────────────────
      try {
        rmSync(stagingDir, { recursive: true, force: true })
        log.info(`[media-lib] Staging dir cleaned up: ${stagingDir}`)
      } catch (err) {
        log.warn(`[media-lib] Failed to clean staging dir: ${err}`)
      }

      // ── Queue additional follow-up jobs if other modes enabled ──
      for (const filePath of extractResult.outputFiles) {
        if (modes.includes('ffv1_archival')) {
          await this.createEncodeJob({
            inputPath: filePath,
            outputDir: expandPath(getSetting('paths.ffv1_output') || params.outputDir),
            preset: 'ffv1',
            preserveInterlaced: params.preserveInterlaced,
            convertSubsToSrt: params.convertSubsToSrt,
            window
          })
        }
        if (modes.includes('streaming_encode') || modes.includes('h264_streaming')) {
          const streamCodec = getSetting('encoding.codec') || 'h264'
          const streamPreset = streamCodec === 'hevc' ? 'hevc' : 'h264'
          await this.createEncodeJob({
            inputPath: filePath,
            outputDir: expandPath(getSetting('paths.streaming_output') || params.outputDir),
            preset: streamPreset,
            preserveInterlaced: params.preserveInterlaced,
            convertSubsToSrt: params.convertSubsToSrt,
            window
          })
        }
      }

      // ── Done! ───────────────────────────────────────────────────
      phase = 'done'
      jobQueries.updateJobStatus(dbId, 'completed')
      this.updateQueueItem(jobId, 'completed')
      const allOutputFiles = skipMainEncode ? extrasOutputFiles : [finalVideoPath, ...extrasOutputFiles]
      const readErrorSummary = this.buildReadErrorSummary(extractResult.readErrors)
      window.webContents.send(IPC.RIP_COMPLETE, {
        jobId,
        outputFiles: allOutputFiles,
        readErrors: extractResult.readErrors,
        readErrorSummary
      })
      const notifyMsg = readErrorSummary
        ? `${movieTitle} (with ${extractResult.readErrors?.length} read errors)`
        : movieTitle
      notifyJobComplete(notifyMsg, allOutputFiles[0] || movieRootDir).catch(() => {})

      log.info(`[media-lib] Pipeline complete — ${allOutputFiles.length} file(s) in ${movieRootDir}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`[media-lib] Pipeline failed: ${msg}`)
      getDiscDetectionService().rippingInProgress = false
      jobQueries.updateJobStatus(dbId, 'failed', { error_message: msg })
      this.updateQueueItem(jobId, 'failed')
      window.webContents.send(IPC.RIP_ERROR, { jobId, error: msg })
      notifyJobFailed(movieTitle, msg).catch(() => {})

      // Clean up staging on failure too
      try { rmSync(stagingDir, { recursive: true, force: true }) } catch {}
    }
  }

  private async executeBackupJob(jobId: string, dbId: number, params: {
    discIndex: number
    outputDir: string
    window: BrowserWindow
    makemkvService: MakeMKVService
  }): Promise<void> {
    const { discIndex, outputDir, window, makemkvService } = params

    jobQueries.updateJobStatus(dbId, 'running')
    this.updateQueueItem(jobId, 'running')
    getDiscDetectionService().rippingInProgress = true

    try {
      const result = await makemkvService.backup({ jobId, discIndex, outputDir, window })

      if (result.success) {
        jobQueries.updateJobStatus(dbId, 'completed')
        this.updateQueueItem(jobId, 'completed')
        window.webContents.send(IPC.RIP_COMPLETE, { jobId })
      } else {
        jobQueries.updateJobStatus(dbId, 'failed', { error_message: result.error })
        this.updateQueueItem(jobId, 'failed')
        window.webContents.send(IPC.RIP_ERROR, { jobId, error: result.error })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      jobQueries.updateJobStatus(dbId, 'failed', { error_message: msg })
      this.updateQueueItem(jobId, 'failed')
    } finally {
      getDiscDetectionService().rippingInProgress = false
    }
  }

  private async executeEncodeJob(jobId: string, dbId: number, params: {
    inputPath: string
    outputDir: string
    preset: string
    preserveInterlaced: boolean
    convertSubsToSrt: boolean
    window: BrowserWindow
  }): Promise<void> {
    const { inputPath, outputDir, preset, preserveInterlaced, window } = params

    jobQueries.updateJobStatus(dbId, 'running')
    this.updateQueueItem(jobId, 'running')

    try {
      // Analyze source file
      const mediaInfo = await this.ffprobeService.analyze(inputPath)
      const totalDuration = mediaInfo.duration

      // Build encoding args
      const args = getEncodingArgs(preset, {
        mediaInfo,
        preserveInterlaced,
        convertSubsToSrt: params.convertSubsToSrt
      })

      const ext = preset === 'ffv1' ? 'mkv' : 'mkv'
      const inputName = inputPath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'output'
      const outputPath = `${outputDir}/${inputName}_${preset}.${ext}`

      const result = await this.ffmpegService.encode({
        jobId,
        inputPath,
        outputPath,
        args,
        totalDuration,
        window
      })

      if (result.success) {
        jobQueries.updateJobStatus(dbId, 'completed', { output_path: outputPath })
        this.updateQueueItem(jobId, 'completed')

        outputFileQueries.createOutputFile({
          job_id: dbId,
          file_path: outputPath,
          format: ext,
          video_codec: preset === 'ffv1' ? 'ffv1' : preset === 'hevc' ? 'hevc' : 'h264'
        })

        window.webContents.send(IPC.ENCODE_COMPLETE, { jobId, outputPath })
      } else {
        jobQueries.updateJobStatus(dbId, 'failed', { error_message: result.error })
        this.updateQueueItem(jobId, 'failed')
        window.webContents.send(IPC.ENCODE_ERROR, { jobId, error: result.error })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      jobQueries.updateJobStatus(dbId, 'failed', { error_message: msg })
      this.updateQueueItem(jobId, 'failed')
      window.webContents.send(IPC.ENCODE_ERROR, { jobId, error: msg })
    }
  }

  async createMusicRipJob(params: {
    trackNumbers: number[]
    artist: string
    albumArtist: string
    album: string
    year: string
    discNumber: number
    totalDiscs: number
    tracks: Array<{ number: number; title: string; artist: string }>
    mbReleaseId: string | null
    isVariousArtists: boolean
    coverArtPath: string | null
    devicePath?: string
    window: BrowserWindow
  }): Promise<{ jobId: string; dbId: number }> {
    const { tracks, window } = params
    const outputDir = expandPath(getSetting('paths.music_output') || '~/Music/Zac the Ripper')

    const disc = discQueries.createDisc({
      title: `${params.artist} - ${params.album}`,
      disc_type: 'AUDIO_CD',
      disc_id: params.mbReleaseId || undefined,
      track_count: tracks.length,
      metadata: JSON.stringify({
        artist: params.artist,
        album: params.album,
        year: params.year,
        musicbrainzReleaseId: params.mbReleaseId
      })
    })

    const job = jobQueries.createJob({
      disc_id: disc.id,
      job_type: 'music_export',
      output_path: outputDir,
      movie_title: `${params.artist} - ${params.album}`
    })

    const jobId = randomUUID()
    this.queue.push({ id: jobId, dbId: job.id, type: 'music_export', status: 'pending' })

    log.info(`[music] Created music_export job ${jobId} — ${params.artist} - ${params.album}`)

    this.executeMusicPipeline(jobId, job.id, { ...params, outputDir })

    return { jobId, dbId: job.id }
  }

  /**
   * Music CD ripping pipeline:
   *   Phase 1 (0-50%): Rip tracks to WAV via cdparanoia
   *   Phase 2 (50-90%): Encode WAV to FLAC via ffmpeg with metadata tags
   *   Phase 3 (90-100%): Organize into Navidrome folder structure
   */
  private async executeMusicPipeline(jobId: string, dbId: number, params: {
    trackNumbers: number[]
    artist: string
    albumArtist: string
    album: string
    year: string
    discNumber: number
    totalDiscs: number
    tracks: Array<{ number: number; title: string; artist: string }>
    mbReleaseId: string | null
    isVariousArtists: boolean
    coverArtPath: string | null
    devicePath?: string
    outputDir: string
    window: BrowserWindow
  }): Promise<void> {
    const { trackNumbers, artist, albumArtist, album, year, discNumber, totalDiscs,
            tracks, mbReleaseId, coverArtPath, devicePath, outputDir, window } = params

    jobQueries.updateJobStatus(dbId, 'running')
    this.updateQueueItem(jobId, 'running')

    const stagingDir = join(tmpdir(), `ztr_music_${jobId.slice(0, 8)}`)
    mkdirSync(stagingDir, { recursive: true })
    log.info(`[music] Staging dir: ${stagingDir}`)

    const sendProgress = (pct: number, message: string) => {
      window.webContents.send(IPC.AUDIO_PROGRESS, { jobId, percentage: pct, message })
      window.webContents.send(IPC.RIP_PROGRESS, { jobId, percentage: pct, message })
    }

    try {
      // ── Phase 1: Rip tracks to WAV (0-50%) ──────────────────────
      sendProgress(0, 'Phase 1/3 — Ripping audio tracks...')
      getDiscDetectionService().rippingInProgress = true

      // Download cover art concurrently if available
      let localCoverPath = coverArtPath
      const coverPromise = (async () => {
        if (mbReleaseId && !localCoverPath) {
          try {
            const dest = join(stagingDir, 'cover.jpg')
            const result = await this.musicBrainzService.downloadCoverArt(mbReleaseId, dest)
            if (result.success) {
              localCoverPath = dest
              log.info(`[music] Cover art downloaded: ${dest}`)
            }
          } catch (err) {
            log.warn(`[music] Cover art download failed (non-fatal): ${err}`)
          }
        }
      })()

      const ripResult = await this.cdRipperService.ripAllTracks({
        jobId,
        trackNumbers,
        outputDir: stagingDir,
        devicePath,
        onProgress: (pct, message) => {
          sendProgress(pct * 0.5, `Phase 1/3 — ${message}`)
        }
      })

      getDiscDetectionService().rippingInProgress = false

      if (!ripResult.success) {
        throw new Error(ripResult.error || 'CD ripping failed')
      }

      log.info(`[music] Phase 1 complete — ${ripResult.outputFiles.length} WAV files`)

      // ── Phase 2: Encode WAV to FLAC (50-90%) ───────────────────
      sendProgress(50, 'Phase 2/3 — Encoding to FLAC...')
      await coverPromise // Ensure cover art download is done

      const compressionLevel = getSetting('audio.flac_compression') || '8'
      const embedCoverArt = getSetting('audio.embed_cover_art') !== 'false'
      const flacFiles: string[] = []
      const ffmpegPath = this.ffmpegService.getPath()
      const totalTracks = tracks.length
      const execFileAsync = promisify(execFile)

      for (let i = 0; i < ripResult.outputFiles.length; i++) {
        const wavPath = ripResult.outputFiles[i]
        const trackInfo = tracks[i]
        if (!trackInfo) continue

        const flacPath = join(stagingDir, `${String(trackInfo.number).padStart(2, '0')}.flac`)
        const trackPct = (i / totalTracks)
        sendProgress(50 + trackPct * 40, `Phase 2/3 — Encoding FLAC ${i + 1}/${totalTracks}`)

        // Build ffmpeg args for FLAC encoding with metadata
        const args: string[] = ['-y']

        // Input: WAV file
        args.push('-i', wavPath)

        // If embedding cover art
        if (embedCoverArt && localCoverPath && existsSync(localCoverPath)) {
          args.push('-i', localCoverPath)
          args.push('-map', '0:a', '-map', '1:v')
          args.push('-c:v', 'copy', '-disposition:v', 'attached_pic')
        }

        // FLAC codec
        args.push('-c:a', 'flac')
        args.push('-compression_level', compressionLevel)

        // Metadata tags
        args.push('-metadata', `title=${trackInfo.title}`)
        args.push('-metadata', `artist=${trackInfo.artist}`)
        args.push('-metadata', `album=${album}`)
        args.push('-metadata', `albumartist=${albumArtist}`)
        args.push('-metadata', `track=${trackInfo.number}/${totalTracks}`)
        args.push('-metadata', `date=${year}`)
        if (totalDiscs > 1) {
          args.push('-metadata', `disc=${discNumber}/${totalDiscs}`)
        }

        args.push(flacPath)

        // Run ffmpeg directly (not via encode() which adds its own -i and output args)
        try {
          await execFileAsync(ffmpegPath, args, { timeout: 120000 })
          flacFiles.push(flacPath)
          log.info(`[music] FLAC encoded: track ${trackInfo.number} "${trackInfo.title}"`)
        } catch (err) {
          log.warn(`[music] FLAC encode failed for track ${trackInfo.number}: ${err}`)
        }
      }

      if (flacFiles.length === 0) {
        throw new Error('No FLAC files were successfully encoded')
      }

      // ── Phase 3: Organize output (90-100%) ─────────────────────
      sendProgress(90, 'Phase 3/3 — Organizing files...')

      // Build Navidrome folder: Artist/Album (Year)/
      const safeArtist = this.sanitizeFilename(albumArtist || artist)
      const safeAlbum = this.sanitizeFilename(album)
      let albumFolder = year ? `${safeAlbum} (${year})` : safeAlbum
      if (totalDiscs > 1) {
        albumFolder += ` (Disc ${discNumber})`
      }

      const finalDir = join(outputDir, safeArtist, albumFolder)
      mkdirSync(finalDir, { recursive: true })
      log.info(`[music] Output dir: ${finalDir}`)

      // Move FLAC files with proper naming: "01 - Track Title.flac"
      const finalOutputFiles: string[] = []
      for (let i = 0; i < flacFiles.length; i++) {
        const trackInfo = tracks[i]
        if (!trackInfo) continue

        const safeTitle = this.sanitizeFilename(trackInfo.title)
        const filename = `${String(trackInfo.number).padStart(2, '0')} - ${safeTitle}.flac`
        const finalPath = join(finalDir, filename)

        try {
          copyFileSync(flacFiles[i], finalPath)
          finalOutputFiles.push(finalPath)
        } catch (err) {
          log.warn(`[music] Failed to copy ${flacFiles[i]} → ${finalPath}: ${err}`)
        }
      }

      // Copy cover art as folder.jpg
      if (localCoverPath && existsSync(localCoverPath)) {
        try {
          copyFileSync(localCoverPath, join(finalDir, 'folder.jpg'))
          log.info(`[music] Cover art copied: folder.jpg`)
        } catch (err) {
          log.warn(`[music] Cover art copy failed: ${err}`)
        }
      }

      // Clean up staging
      try {
        rmSync(stagingDir, { recursive: true, force: true })
        log.info(`[music] Staging dir cleaned up`)
      } catch {}

      // Record output files
      for (const filePath of finalOutputFiles) {
        outputFileQueries.createOutputFile({
          job_id: dbId,
          file_path: filePath,
          format: 'flac',
          audio_codec: 'flac'
        })
      }

      // Done
      sendProgress(100, 'Complete')
      jobQueries.updateJobStatus(dbId, 'completed')
      this.updateQueueItem(jobId, 'completed')

      const displayTitle = `${artist} - ${album}`
      window.webContents.send(IPC.AUDIO_COMPLETE, {
        jobId,
        outputFiles: finalOutputFiles,
        outputDir: finalDir
      })
      window.webContents.send(IPC.RIP_COMPLETE, {
        jobId,
        outputFiles: finalOutputFiles
      })
      notifyJobComplete(displayTitle, finalDir).catch(() => {})

      log.info(`[music] Pipeline complete — ${finalOutputFiles.length} FLAC files in ${finalDir}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`[music] Pipeline failed: ${msg}`)
      getDiscDetectionService().rippingInProgress = false
      jobQueries.updateJobStatus(dbId, 'failed', { error_message: msg })
      this.updateQueueItem(jobId, 'failed')
      window.webContents.send(IPC.AUDIO_ERROR, { jobId, error: msg })
      window.webContents.send(IPC.RIP_ERROR, { jobId, error: msg })
      notifyJobFailed(`${params.artist} - ${params.album}`, msg).catch(() => {})

      try { rmSync(stagingDir, { recursive: true, force: true }) } catch {}
    }
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\.+$/, '').trim() || 'Unknown'
  }

  cancelJob(jobId: string): boolean {
    const item = this.queue.find(q => q.id === jobId)
    if (!item) return false

    if (item.status === 'running') {
      this.ffmpegService.cancelJob(jobId)
      this.ffmpegRipperService.cancelJob(jobId)
      this.cdRipperService.cancelJob(jobId)
      jobQueries.updateJobStatus(item.dbId, 'cancelled')
      this.updateQueueItem(jobId, 'cancelled')
    } else if (item.status === 'pending') {
      this.queue = this.queue.filter(q => q.id !== jobId)
      jobQueries.updateJobStatus(item.dbId, 'cancelled')
    }

    return true
  }

  getActiveJobs(): QueuedJob[] {
    return this.queue.filter(j => j.status === 'running' || j.status === 'pending')
  }

  private buildReadErrorSummary(readErrors?: ReadError[]): string | null {
    if (!readErrors || readErrors.length === 0) return null
    const byFile = new Map<string, number>()
    for (const err of readErrors) {
      byFile.set(err.file, (byFile.get(err.file) || 0) + 1)
    }
    const lines = [...byFile.entries()]
      .map(([file, count]) => `${file}: ${count} error(s)`)
      .join(', ')
    return `${readErrors.length} read error(s) — ${lines}`
  }

  private updateQueueItem(jobId: string, status: QueuedJob['status']): void {
    const item = this.queue.find(q => q.id === jobId)
    if (item) item.status = status
  }
}
