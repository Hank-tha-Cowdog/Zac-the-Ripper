import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'
import { runProcess, type RunningProcess } from '../util/process-runner'
import { getSetting } from '../database/queries/settings'
import { findToolPath } from '../util/platform'
import { createLogger } from '../util/logger'

const execFileAsync = promisify(execFile)
const log = createLogger('cd-ripper')

export interface CDTrackInfo {
  number: number
  startSector: number
  endSector: number
  durationSeconds: number
}

export interface CDDiscInfo {
  trackCount: number
  tracks: CDTrackInfo[]
  leadOutSector: number
  totalDurationSeconds: number
  devicePath: string
  /** LBA offsets for each track (1-indexed values), used for MusicBrainz disc ID */
  trackOffsets: number[]
}

export interface CDRipResult {
  success: boolean
  outputFiles: string[]
  error?: string
}

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
      return this.parseTOC(stderr, devicePath || '/dev/cdrom')
    } catch (err) {
      log.error(`queryTOC failed: ${err}`)
      return null
    }
  }

  /**
   * Parse cdparanoia -Q output.
   * Format:
   *   track  length    begin    copy pre ch
   *   ===========================================================
   *     1.   18000 [04:00.00]      150 [00:02.00]    no   no  2
   *     2.   22350 [04:58.00]    18150 [04:02.00]    no   no  2
   *   TOTAL  40200 [08:56.00]    (audio only)
   */
  private parseTOC(output: string, devicePath: string): CDDiscInfo | null {
    const lines = output.split('\n')
    const tracks: CDTrackInfo[] = []
    let leadOutSector = 0
    const trackOffsets: number[] = []

    for (const line of lines) {
      // Match track lines: "  1.   18000 [04:00.00]      150 [00:02.00]    no   no  2"
      const trackMatch = line.match(/^\s*(\d+)\.\s+(\d+)\s+\[[\d:.]+\]\s+(\d+)\s+\[[\d:.]+\]/)
      if (trackMatch) {
        const number = parseInt(trackMatch[1])
        const sectorLength = parseInt(trackMatch[2])
        const startSector = parseInt(trackMatch[3])
        const endSector = startSector + sectorLength - 1
        const durationSeconds = sectorLength / 75 // 75 sectors per second for audio CDs

        tracks.push({ number, startSector, endSector, durationSeconds })
        trackOffsets.push(startSector)
        continue
      }

      // Match TOTAL line: "TOTAL  40200 [08:56.00]    (audio only)"
      const totalMatch = line.match(/TOTAL\s+(\d+)\s+\[[\d:.]+\]/)
      if (totalMatch) {
        // Lead-out sector = last track start + last track length
        // Or compute from TOTAL length + first track offset
        if (tracks.length > 0) {
          const lastTrack = tracks[tracks.length - 1]
          leadOutSector = lastTrack.endSector + 1
        }
      }
    }

    if (tracks.length === 0) {
      log.warn('parseTOC: no tracks found in cdparanoia output')
      return null
    }

    // If we didn't get leadOutSector from TOTAL, compute it
    if (leadOutSector === 0 && tracks.length > 0) {
      leadOutSector = tracks[tracks.length - 1].endSector + 1
    }

    const totalDurationSeconds = tracks.reduce((sum, t) => sum + t.durationSeconds, 0)

    log.info(`parseTOC: ${tracks.length} tracks, leadOut=${leadOutSector}, total=${totalDurationSeconds.toFixed(0)}s`)
    return {
      trackCount: tracks.length,
      tracks,
      leadOutSector,
      totalDurationSeconds,
      devicePath,
      trackOffsets
    }
  }

  /**
   * Rip a single track to WAV.
   */
  async ripTrack(params: {
    jobId: string
    trackNumber: number
    outputPath: string
    devicePath?: string
    onProgress?: (percentage: number) => void
  }): Promise<CDRipResult> {
    const cdparanoia = this.getCdparanoiaPath()
    if (!cdparanoia) return { success: false, outputFiles: [], error: 'cdparanoia not found' }

    const { jobId, trackNumber, outputPath, devicePath, onProgress } = params
    const subJobId = `${jobId}_track${trackNumber}`

    const args = ['-w', String(trackNumber), outputPath]
    if (devicePath) args.unshift('-d', devicePath)

    log.info(`ripTrack: track ${trackNumber} → ${outputPath}`)

    return new Promise((resolve) => {
      let lastActivity = Date.now()
      const STALL_TIMEOUT_MS = 3 * 60 * 1000 // 3 min stall detection

      const stallTimer = setInterval(() => {
        if (Date.now() - lastActivity > STALL_TIMEOUT_MS) {
          log.error(`ripTrack: stall detected for track ${trackNumber}, killing process`)
          clearInterval(stallTimer)
          const proc = this.activeProcesses.get(subJobId)
          if (proc) proc.kill()
          resolve({ success: false, outputFiles: [], error: `Stall detected ripping track ${trackNumber}` })
        }
      }, 15000)

      const proc = runProcess({
        command: cdparanoia,
        args,
        onStderr: (line) => {
          lastActivity = Date.now()
          // cdparanoia progress: "##: -2 [read] @ 12345"
          // or sector progress line with numbers
          const sectorMatch = line.match(/\(== PROGRESS ==\)\s+\[(\d+)\.\d+%\]/)
          if (sectorMatch && onProgress) {
            onProgress(parseFloat(sectorMatch[1]))
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

          if (code === 0 || existsSync(outputPath)) {
            log.info(`ripTrack: track ${trackNumber} completed`)
            resolve({ success: true, outputFiles: [outputPath] })
          } else {
            log.error(`ripTrack: track ${trackNumber} failed with code ${code}`)
            resolve({ success: false, outputFiles: [], error: `cdparanoia exit code ${code}` })
          }
        }
      })

      this.activeProcesses.set(subJobId, proc)
    })
  }

  /**
   * Rip all selected tracks sequentially, reporting overall progress.
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

    for (let i = 0; i < totalTracks; i++) {
      const trackNum = trackNumbers[i]
      const outputPath = join(outputDir, `${String(trackNum).padStart(2, '0')}.wav`)

      onProgress?.(
        (i / totalTracks) * 100,
        `Ripping track ${i + 1}/${totalTracks}`
      )

      const result = await this.ripTrack({
        jobId,
        trackNumber: trackNum,
        outputPath,
        devicePath,
        onProgress: (trackPct) => {
          const overall = ((i + trackPct / 100) / totalTracks) * 100
          onProgress?.(overall, `Ripping track ${i + 1}/${totalTracks}: ${trackPct.toFixed(0)}%`)
        }
      })

      if (!result.success) {
        return { success: false, outputFiles, error: result.error }
      }

      outputFiles.push(outputPath)
    }

    return { success: true, outputFiles }
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
}
