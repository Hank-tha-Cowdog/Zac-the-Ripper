import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { tmpdir, homedir } from 'os'
import { join, dirname } from 'path'
import { mkdirSync, rmSync, copyFileSync } from 'fs'
import { MakeMKVService } from './makemkv'
import { FFmpegService } from './ffmpeg'
import { FFprobeService } from './ffprobe'
import { KodiOutputService, EXTRAS_FOLDER_MAP } from './kodi-output'
import { TMDBService } from './tmdb'
import type { DiscInfo } from './disc-detection'
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
  private ffprobeService = new FFprobeService()
  private kodiService = new KodiOutputService()
  private tmdbService = new TMDBService()
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
        discInfo: discInfo || undefined
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
        discId: disc.id
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

        window.webContents.send(IPC.RIP_COMPLETE, {
          jobId,
          outputFiles: result.outputFiles
        })
        notifyJobComplete('MKV Rip', result.outputFiles[0]).catch(() => {})

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
            const codec = getSetting('encoding.codec') || 'hevc'
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
        jobQueries.updateJobStatus(dbId, 'failed', { error_message: result.error })
        this.updateQueueItem(jobId, 'failed')
        window.webContents.send(IPC.RIP_ERROR, { jobId, error: result.error })
        notifyJobFailed('MKV Rip', result.error).catch(() => {})
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
  }): Promise<void> {
    const { discIndex, titleIds, window, makemkvService, modes } = params
    const opts = params.kodiOptions as {
      mediaType?: string; title?: string; year?: string; tmdbId?: number
      edition?: string; isExtrasDisc?: boolean; setName?: string; setOverview?: string
      soundVersion?: string; discNumber?: number; totalDiscs?: number
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

      // When trackMeta has categories, ignore isExtrasDisc — trackMeta takes precedence.
      // isExtrasDisc is only used for legacy single-file-to-Extras mode (no trackMeta).
      const hasTrackMeta = params.trackMeta && params.trackMeta.length > 0
      const hasMainTrack = hasTrackMeta && params.trackMeta!.some(m => m.category === 'main')
      const useExtrasDiscMode = opts?.isExtrasDisc && !hasTrackMeta

      // Always compute the movie root dir (Movies/Title (Year)/) — extras subfolders go here
      const { outputDir: movieRootDir } = this.kodiService.buildMoviePath({
        libraryPath: primaryLibraryPath,
        title: movieTitle,
        year: movieYear
      })

      // Compute main feature path (may not be used if all tracks are extras)
      const { videoPath: finalVideoPath, outputDir: libraryOutputDir } = this.kodiService.buildMoviePath({
        libraryPath: primaryLibraryPath,
        title: movieTitle,
        year: movieYear,
        edition: opts?.edition,
        soundVersion: opts?.soundVersion,
        discNumber: opts?.discNumber,
        totalDiscs: opts?.totalDiscs,
        isExtrasDisc: useExtrasDiscMode
      })

      // Skip main feature encode if trackMeta exists but has no 'main' category
      const skipMainEncode = hasTrackMeta && !hasMainTrack

      mkdirSync(movieRootDir, { recursive: true })
      if (!skipMainEncode) mkdirSync(libraryOutputDir, { recursive: true })
      log.info(`[media-lib] Movie root dir: ${movieRootDir}`)
      log.info(`[media-lib] Output dir: ${libraryOutputDir}`)
      log.info(`[media-lib] Final video path: ${finalVideoPath} (skipMainEncode=${skipMainEncode})`)

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
      const codec = getSetting('encoding.codec') || 'hevc'
      const preset = codec === 'hevc' ? 'hevc' : 'h264'
      log.info(`[media-lib] Codec preset: ${preset}`)

      // ── Step 1: Extract from disc ──────────────────────────────────
      sendProgress(0, 'Step 1/3 — Starting disc extraction...')

      log.info(`[media-lib] Starting MakeMKV extraction: disc:${discIndex} titles=[${titleIds}] → ${stagingDir}`)
      getDiscDetectionService().rippingInProgress = true

      const extractResult = await makemkvService.ripTitles({
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

      getDiscDetectionService().rippingInProgress = false

      if (!extractResult.success || extractResult.outputFiles.length === 0) {
        throw new Error(extractResult.error || 'MKV extraction produced no files')
      }

      log.info(`[media-lib] MakeMKV finished — ${extractResult.outputFiles.length} file(s) extracted`)

      // ── Determine main feature vs extras from trackMeta ──────────
      const trackMetaList = params.trackMeta
      let mainFileIndex = 0
      if (trackMetaList && trackMetaList.length > 0) {
        const mainMeta = trackMetaList.findIndex(m => m.category === 'main')
        if (mainMeta >= 0) mainFileIndex = mainMeta
      }

      // ── Step 2: Encode main feature (if applicable) ──────────────
      phase = 'encode'

      if (!skipMainEncode) {
        const stagingMkvPath = extractResult.outputFiles[mainFileIndex]
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
      if (trackMetaList && trackMetaList.length > 0 && extractResult.outputFiles.length > 0) {
        const extrasEntries = trackMetaList
          .map((meta, i) => ({ meta, file: extractResult.outputFiles[i] }))
          .filter((_, i) => i !== mainFileIndex || skipMainEncode)

        for (let ei = 0; ei < extrasEntries.length; ei++) {
          const { meta: extraMeta, file: extrasFile } = extrasEntries[ei]
          if (extraMeta.category === 'main') continue // Already encoded above
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

      const finalizeParams = {
        libraryPath: primaryLibraryPath,
        title: movieTitle,
        year: movieYear,
        sourceFile: finalVideoPath,
        videoAlreadyAtPath: finalVideoPath,
        metadata: {
          tmdb_id: opts?.tmdbId,
          imdb_id: tmdbDetails?.imdb_id || undefined,
          plot: tmdbDetails?.overview || undefined,
          tagline: tmdbDetails?.tagline || undefined,
          genres: tmdbDetails?.genres?.map(g => g.name),
          runtime: tmdbDetails?.runtime || undefined,
          voteAverage: tmdbDetails?.vote_average || undefined
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
          const streamCodec = getSetting('encoding.codec') || 'hevc'
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
      window.webContents.send(IPC.RIP_COMPLETE, { jobId, outputFiles: allOutputFiles })
      notifyJobComplete(movieTitle, allOutputFiles[0] || movieRootDir).catch(() => {})

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

  cancelJob(jobId: string): boolean {
    const item = this.queue.find(q => q.id === jobId)
    if (!item) return false

    if (item.status === 'running') {
      this.ffmpegService.cancelJob(jobId)
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

  private updateQueueItem(jobId: string, status: QueuedJob['status']): void {
    const item = this.queue.find(q => q.id === jobId)
    if (item) item.status = status
  }
}
