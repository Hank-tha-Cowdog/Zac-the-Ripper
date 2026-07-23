import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'
import { runProcess, type RunningProcess } from '../util/process-runner'
import { getSetting } from '../database/queries/settings'
import { findToolPath } from '../util/platform'
import { createLogger } from '../util/logger'
import { getJobTranscriptPath } from '../util/job-transcript'
import { parseCDToc, type CDTrackInfo, type CDDiscInfo } from './cd-toc-parser'
import { parseCdparanoiaProgressSector, cdparanoiaSectorToPercent } from './cdparanoia-progress'
import { validateWavFile } from '../util/wav-validate'

const execFileAsync = promisify(execFile)
const log = createLogger('cd-ripper')

export type { CDTrackInfo, CDDiscInfo }

export interface CDTrackFile {
  trackNumber: number
  filePath: string
}

export interface CDRipResult {
  success: boolean
  /** @deprecated positional — use trackFiles, which survives a non-contiguous track selection */
  outputFiles: string[]
  trackFiles: CDTrackFile[]
  /** Tracks that failed after retries — a partial success, not a hard failure. */
  skippedTracks: number[]
  error?: string
}

const MAX_TRACK_RETRIES = 2

export class CDRipperService {
  private activeProcesses = new Map<string, RunningProcess>()

  private getCdparanoiaPath(): string | null {
    const settingPath = getSetting('tools.cdparanoia_path')
    if (settingPath && existsSync(settingPath)) return settingPath
    return findToolPath('cdparanoia')
  }

  /**
   * Query the CD Table of Contents via cdparanoia -Q.
   * cdparanoia outputs TOC to stderr and often exits non-zero even with valid data.
   */
  async queryTOC(devicePath?: string): Promise<CDDiscInfo | null> {
    const cdparanoia = this.getCdparanoiaPath()
    if (!cdparanoia) {
      log.warn('queryTOC: cdparanoia not found')
      return null
    }

    const args = ['-Q']
    if (devicePath) args.push('-d', devicePath)

    log.info(`queryTOC: ${cdparanoia} ${args.join(' ')}`)

    try {
      let stderr = ''

      // cdparanoia -Q outputs to stderr and may exit non-zero
      try {
        const result = await execFileAsync(cdparanoia, args, { timeout: 30000 })
        stderr = result.stderr || result.stdout || ''
      } catch (execErr: unknown) {
        const err = execErr as { stderr?: string; stdout?: string; code?: number | string }
        stderr = err.stderr || err.stdout || ''
        if (!stderr) {
          log.warn(`queryTOC: cdparanoia failed with no output: ${execErr}`)
          return null
        }
      }

      log.debug(`queryTOC stderr:\n${stderr}`)
      const info = parseCDToc(stderr, devicePath || '/dev/cdrom')
      if (!info) {
        log.warn('queryTOC: no tracks found in cdparanoia output')
        return null
      }
      log.info(`queryTOC: ${info.trackCount} tracks, leadOut=${info.leadOutSector}, total=${info.totalDurationSeconds.toFixed(0)}s`)
      return info
    } catch (err) {
      log.error(`queryTOC failed: ${err}`)
      return null
    }
  }

  /** Drive read-offset correction in PCM samples (cdparanoia -O/--sample-offset), e.g. "+667" for many Plextor drives. */
  private getDriveReadOffset(): string | null {
    const raw = (getSetting('audio.drive_read_offset') || '').trim()
    if (!raw || Number.isNaN(Number(raw))) return null
    return raw
  }

  /**
   * Rip a single track to WAV, one attempt — no retry (see ripAllTracks for
   * the retry wrapper). Requires the track's sector range (from queryTOC)
   * for both live progress percentage and post-rip WAV size validation.
   */
  async ripTrack(params: {
    jobId: string
    trackNumber: number
    outputPath: string
    startSector: number
    endSector: number
    devicePath?: string
    onProgress?: (percentage: number) => void
  }): Promise<CDRipResult> {
    const cdparanoia = this.getCdparanoiaPath()
    if (!cdparanoia) return { success: false, outputFiles: [], trackFiles: [], skippedTracks: [params.trackNumber], error: 'cdparanoia not found' }

    const { jobId, trackNumber, outputPath, startSector, endSector, devicePath, onProgress } = params
    const subJobId = `${jobId}_track${trackNumber}`

    // -e forces progress output to stderr even though it's a pipe, not a
    // TTY (cdparanoia otherwise silently drops progress reporting under
    // stdio capture — see cdparanoia-progress.ts doc comment).
    const args = ['-e', '-w', String(trackNumber), outputPath]
    const driveOffset = this.getDriveReadOffset()
    if (driveOffset) args.unshift('-O', driveOffset)
    if (devicePath) args.unshift('-d', devicePath)

    log.info(`ripTrack: track ${trackNumber} → ${outputPath}${driveOffset ? ` (offset ${driveOffset})` : ''}`)

    return new Promise((resolve) => {
      let lastActivity = Date.now()
      const STALL_TIMEOUT_MS = 3 * 60 * 1000 // 3 min stall detection

      const stallTimer = setInterval(() => {
        if (Date.now() - lastActivity > STALL_TIMEOUT_MS) {
          log.error(`ripTrack: stall detected for track ${trackNumber}, killing process`)
          clearInterval(stallTimer)
          const proc = this.activeProcesses.get(subJobId)
          if (proc) proc.kill()
          resolve({ success: false, outputFiles: [], trackFiles: [], skippedTracks: [trackNumber], error: `Stall detected ripping track ${trackNumber}` })
        }
      }, 15000)

      const proc = runProcess({
        command: cdparanoia,
        args,
        transcriptPath: getJobTranscriptPath(subJobId, 'cdparanoia'),
        onStderr: (line) => {
          lastActivity = Date.now()
          const sector = parseCdparanoiaProgressSector(line)
          if (sector !== null && onProgress) {
            onProgress(cdparanoiaSectorToPercent(sector, startSector, endSector))
          }
          log.debug(`cdparanoia: ${line}`)
        },
        onStdout: (line) => {
          lastActivity = Date.now()
          log.debug(`cdparanoia stdout: ${line}`)
        },
        onExit: (code) => {
          clearInterval(stallTimer)
          this.activeProcesses.delete(subJobId)

          // cdparanoia's exit code alone is not trustworthy — verified
          // against its source that it exits 0 even when a track was
          // skipped and unlinked after uncorrectable errors. The WAV
          // file's own header + byte count is the real success signal.
          const expectedSectors = endSector - startSector + 1
          const validation = validateWavFile(outputPath, expectedSectors)

          if (validation.valid) {
            if (code !== 0) {
              log.warn(`ripTrack: track ${trackNumber} exited ${code} but output validated OK (${validation.actualBytes} bytes) — treating as success`)
            } else {
              log.info(`ripTrack: track ${trackNumber} completed (${validation.actualBytes} bytes)`)
            }
            resolve({ success: true, outputFiles: [outputPath], trackFiles: [{ trackNumber, filePath: outputPath }], skippedTracks: [] })
          } else {
            log.error(`ripTrack: track ${trackNumber} failed validation: ${validation.reason} (exit code ${code})`)
            resolve({ success: false, outputFiles: [], trackFiles: [], skippedTracks: [trackNumber], error: validation.reason || `cdparanoia exit code ${code}` })
          }
        }
      })

      this.activeProcesses.set(subJobId, proc)
    })
  }

  /**
   * Rip all selected tracks sequentially, reporting overall progress.
   * Retries a failing track up to MAX_TRACK_RETRIES times before giving up
   * on it and continuing with the rest of the album — a single damaged
   * track (or a transient drive hiccup) no longer aborts the whole rip.
   */
  async ripAllTracks(params: {
    jobId: string
    trackNumbers: number[]
    outputDir: string
    devicePath?: string
    onProgress?: (percentage: number, message: string) => void
  }): Promise<CDRipResult> {
    const { jobId, trackNumbers, outputDir, devicePath, onProgress } = params
    const totalTracks = trackNumbers.length
    const outputFiles: string[] = []
    const trackFiles: CDTrackFile[] = []
    const skippedTracks: number[] = []

    const toc = await this.queryTOC(devicePath)
    if (!toc) {
      return { success: false, outputFiles, trackFiles, skippedTracks: trackNumbers, error: 'Could not read disc table of contents' }
    }
    const trackInfoByNumber = new Map(toc.tracks.map(t => [t.number, t]))

    for (let i = 0; i < totalTracks; i++) {
      const trackNum = trackNumbers[i]
      const trackInfo = trackInfoByNumber.get(trackNum)
      if (!trackInfo) {
        log.error(`ripAllTracks: track ${trackNum} not found in disc TOC — skipping`)
        skippedTracks.push(trackNum)
        continue
      }

      const outputPath = join(outputDir, `${String(trackNum).padStart(2, '0')}.wav`)

      onProgress?.(
        (i / totalTracks) * 100,
        `Ripping track ${i + 1}/${totalTracks}`
      )

      let result: CDRipResult | null = null
      for (let attempt = 0; attempt <= MAX_TRACK_RETRIES; attempt++) {
        if (attempt > 0) {
          log.warn(`ripAllTracks: retrying track ${trackNum} (attempt ${attempt + 1}/${MAX_TRACK_RETRIES + 1})`)
          onProgress?.((i / totalTracks) * 100, `Ripping track ${i + 1}/${totalTracks} (retry ${attempt}/${MAX_TRACK_RETRIES})`)
        }

        result = await this.ripTrack({
          jobId,
          trackNumber: trackNum,
          outputPath,
          startSector: trackInfo.startSector,
          endSector: trackInfo.endSector,
          devicePath,
          onProgress: (trackPct) => {
            const overall = ((i + trackPct / 100) / totalTracks) * 100
            onProgress?.(overall, `Ripping track ${i + 1}/${totalTracks}: ${trackPct.toFixed(0)}%`)
          }
        })

        if (result.success) break
      }

      if (!result || !result.success) {
        log.error(`ripAllTracks: track ${trackNum} failed after ${MAX_TRACK_RETRIES + 1} attempt(s) — skipping, continuing with remaining tracks`)
        skippedTracks.push(trackNum)
        continue
      }

      outputFiles.push(outputPath)
      trackFiles.push({ trackNumber: trackNum, filePath: outputPath })
    }

    if (trackFiles.length === 0) {
      return { success: false, outputFiles, trackFiles, skippedTracks, error: 'All tracks failed to rip' }
    }

    return { success: true, outputFiles, trackFiles, skippedTracks }
  }

  cancelJob(jobId: string): void {
    // Kill exact match and prefix matches (sub-jobs)
    for (const [id, proc] of this.activeProcesses.entries()) {
      if (id === jobId || id.startsWith(`${jobId}_`)) {
        log.info(`cancelJob: killing ${id}`)
        proc.kill()
        this.activeProcesses.delete(id)
      }
    }
  }

  /** Kill every active cdparanoia process immediately — used on app quit. */
  killAll(): void {
    for (const [id, proc] of this.activeProcesses) {
      proc.kill()
      this.activeProcesses.delete(id)
    }
  }
}
