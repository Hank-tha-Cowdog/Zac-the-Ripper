import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { MakeMKVService } from './makemkv'
import { FFmpegService } from './ffmpeg'
import { FFprobeService } from './ffprobe'
import { KodiOutputService } from './kodi-output'
import { TMDBService } from './tmdb'
import type { DiscInfo } from './disc-detection'
import * as jobQueries from '../database/queries/jobs'
import * as discQueries from '../database/queries/discs'
import * as outputFileQueries from '../database/queries/output-files'
import { getSetting } from '../database/queries/settings'
import { getEncodingArgs } from '../encoding-presets'
import { createLogger } from '../util/logger'
import { IPC } from '../../shared/ipc-channels'

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
    kodiOptions?: unknown
    discSetId?: number
    discNumber?: number
    window: BrowserWindow
    makemkvService: MakeMKVService
  }): Promise<{ jobId: string; dbId: number }> {
    const { discIndex, titleIds, modes, window, makemkvService, discSetId, discNumber } = params
    const outputDir = expandPath(params.outputDir)

    // Create disc record
    const discInfo = await new (await import('./disc-detection')).DiscDetectionService().getDiscInfo(discIndex)
    const disc = discQueries.createDisc({
      title: discInfo?.title || `Disc ${discIndex}`,
      disc_type: discInfo?.discType || 'DVD',
      disc_id: discInfo?.discId,
      track_count: discInfo?.trackCount || titleIds.length,
      metadata: JSON.stringify(discInfo || {}),
      disc_set_id: discSetId,
      disc_number: discNumber
    })

    // ── kodi_export: full pipeline — extract → encode → organize ────────
    if (modes.includes('kodi_export')) {
      const kodiLibraryPath = expandPath(getSetting('kodi.library_path') || '')
      const kodiJob = jobQueries.createJob({
        disc_id: disc.id,
        job_type: 'kodi_export',
        output_path: kodiLibraryPath || outputDir
      })

      const jobId = randomUUID()
      this.queue.push({ id: jobId, dbId: kodiJob.id, type: 'kodi_export', status: 'pending' })

      log.info(`[kodi] Created kodi_export job ${jobId} — library=${kodiLibraryPath}, staging=${outputDir}`)

      this.executeKodiPipeline(jobId, kodiJob.id, {
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
        kodiLibraryPath,
        discSetId,
        discNumber,
        discInfo: discInfo || undefined
      })

      return { jobId, dbId: kodiJob.id }
    }

    // Create MKV rip job if mkv_rip mode is enabled
    if (modes.includes('mkv_rip')) {
      const mkvJob = jobQueries.createJob({
        disc_id: disc.id,
        job_type: 'mkv_rip',
        output_path: outputDir
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
        output_path: outputDir
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
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      jobQueries.updateJobStatus(dbId, 'failed', { error_message: msg })
      this.updateQueueItem(jobId, 'failed')
      window.webContents.send(IPC.RIP_ERROR, { jobId, error: msg })
    }
  }

  /**
   * Kodi export pipeline — disc extraction → HEVC encoding → Kodi organization.
   *
   * Architecture:
   *   Disc → MakeMKV → temp staging MKV → FFmpeg encode → Kodi library
   *
   * MakeMKV extracts the MKV to a temp staging directory. After extraction
   * completes, FFmpeg encodes HEVC and writes to the final Kodi directory.
   * TMDB metadata and artwork are fetched concurrently during extraction.
   */
  private async executeKodiPipeline(jobId: string, dbId: number, params: {
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
    kodiLibraryPath: string
    discSetId?: number
    discNumber?: number
    discInfo?: DiscInfo
  }): Promise<void> {
    const { discIndex, titleIds, window, makemkvService, modes } = params
    const opts = params.kodiOptions as {
      mediaType?: string; title?: string; year?: string; tmdbId?: number
      edition?: string; isExtrasDisc?: boolean; setName?: string; setOverview?: string
    } | undefined

    const kodiLibraryPath = params.kodiLibraryPath
    const movieTitle = opts?.title || 'Unknown'
    const movieYear = parseInt(opts?.year || '') || new Date().getFullYear()

    jobQueries.updateJobStatus(dbId, 'running')
    this.updateQueueItem(jobId, 'running')

    // ── Create temp staging directory for intermediate MKV ─────────
    const stagingDir = join(tmpdir(), `ztr_stage_${jobId.slice(0, 8)}`)
    mkdirSync(stagingDir, { recursive: true })
    log.info(`[kodi] Staging dir: ${stagingDir}`)

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
      // ── Determine final Kodi output paths ───────────────────────
      if (!kodiLibraryPath) throw new Error('Kodi library path not configured — set it in Settings > Kodi')

      const { videoPath: finalVideoPath, outputDir: kodiOutputDir } = this.kodiService.buildMoviePath({
        libraryPath: kodiLibraryPath,
        title: movieTitle,
        year: movieYear,
        edition: opts?.edition,
        isExtrasDisc: opts?.isExtrasDisc
      })

      mkdirSync(kodiOutputDir, { recursive: true })
      log.info(`[kodi] Kodi output dir: ${kodiOutputDir}`)
      log.info(`[kodi] Final video path: ${finalVideoPath}`)

      // ── Fetch TMDB metadata + artwork concurrently with rip ─────
      let tmdbDetails: Awaited<ReturnType<TMDBService['getDetails']>> = null
      let posterLocalPath: string | undefined
      let fanartLocalPath: string | undefined

      const tmdbPromise = (async () => {
        if (!opts?.tmdbId) return
        try {
          tmdbDetails = await this.tmdbService.getDetails(opts.tmdbId, opts.mediaType || 'movie')
          log.info(`[kodi] TMDB details fetched: "${tmdbDetails?.title}" (${tmdbDetails?.imdb_id || 'no IMDB'})`)

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
          log.warn(`[kodi] TMDB fetch failed (non-fatal): ${err}`)
        }
      })()

      // ── Determine encoding preset ──
      const codec = getSetting('encoding.codec') || 'hevc'
      const preset = codec === 'hevc' ? 'hevc' : 'h264'
      log.info(`[kodi] Codec preset: ${preset}`)

      // ── Step 1: Extract from disc ──────────────────────────────────
      sendProgress(0, 'Step 1/3 — Starting disc extraction...')

      log.info(`[kodi] Starting MakeMKV extraction: disc:${discIndex} titles=[${titleIds}] → ${stagingDir}`)

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

      if (!extractResult.success || extractResult.outputFiles.length === 0) {
        throw new Error(extractResult.error || 'MKV extraction produced no files')
      }

      log.info(`[kodi] MakeMKV finished — ${extractResult.outputFiles.length} file(s) extracted`)
      const stagingMkvPath = extractResult.outputFiles[0]

      // ── Step 2: Encode the complete MKV ──────────────────────────
      phase = 'encode'
      sendProgress(50, 'Step 2/3 — Analyzing extracted file...')

      let encodeResult: { success: boolean; error?: string }

      try {
        // Analyze the complete staging MKV with ffprobe
        const completeMediaInfo = await this.ffprobeService.analyze(stagingMkvPath)
        log.info(`[kodi] ffprobe: ${completeMediaInfo.videoStreams[0]?.width}x${completeMediaInfo.videoStreams[0]?.height} ` +
          `${completeMediaInfo.audioStreams.length} audio, ${completeMediaInfo.subtitleStreams.length} subs, ` +
          `duration=${completeMediaInfo.duration.toFixed(1)}s`)

        // Build encoding args with accurate ffprobe data
        const encodeArgs = getEncodingArgs(preset, {
          mediaInfo: completeMediaInfo,
          preserveInterlaced: params.preserveInterlaced,
          convertSubsToSrt: params.convertSubsToSrt
        })
        log.info(`[kodi] FFmpeg args: ${encodeArgs.join(' ')}`)

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
          log.info(`[kodi] Encode succeeded: ${finalVideoPath}`)
        } else {
          log.error(`[kodi] Encode failed: ${encodeResult.error}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`[kodi] Encode crashed: ${msg}`)
        encodeResult = { success: false, error: msg }
      }

      if (!encodeResult.success) {
        throw new Error(encodeResult.error || 'HEVC encoding failed')
      }

      log.info(`[kodi] Encode complete: ${finalVideoPath}`)

      // Record output files in DB
      outputFileQueries.createOutputFile({
        job_id: dbId,
        file_path: finalVideoPath,
        format: 'mkv',
        video_codec: preset === 'hevc' ? 'hevc' : 'h264'
      })

      // ── Finalize: NFO, artwork, Kodi structure ──────────────────
      phase = 'kodi-org'
      sendProgress(92, 'Step 3/3 — Organizing for Kodi (NFO, artwork)...')

      // Wait for TMDB fetch to complete (likely already done)
      await tmdbPromise

      this.kodiService.finalizeMovie({
        libraryPath: kodiLibraryPath,
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
        isExtrasDisc: opts?.isExtrasDisc,
        setName: opts?.setName,
        setOverview: opts?.setOverview,
        discNumber: params.discNumber
      })

      log.info(`[kodi] Kodi organization complete`)

      // ── Clean up staging directory ──────────────────────────────
      try {
        rmSync(stagingDir, { recursive: true, force: true })
        log.info(`[kodi] Staging dir cleaned up: ${stagingDir}`)
      } catch (err) {
        log.warn(`[kodi] Failed to clean staging dir: ${err}`)
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
      window.webContents.send(IPC.RIP_COMPLETE, { jobId, outputFiles: [finalVideoPath] })

      log.info(`[kodi] Pipeline complete — ${finalVideoPath}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`[kodi] Pipeline failed: ${msg}`)
      jobQueries.updateJobStatus(dbId, 'failed', { error_message: msg })
      this.updateQueueItem(jobId, 'failed')
      window.webContents.send(IPC.RIP_ERROR, { jobId, error: msg })

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
