import { BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdirSync, existsSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { runProcess, RunningProcess } from '../util/process-runner'
import { findToolPath, getBundledBinPath } from '../util/platform'
import { getDiscDetectionService } from './disc-detection'
import type { DiscInfo, TrackInfo } from './disc-detection'
import type { RipResult } from './makemkv'
import { createLogger } from '../util/logger'

const execFileAsync = promisify(execFile)
const log = createLogger('ffmpeg-ripper')

export class FFmpegRipperService {
  private activeProcesses = new Map<string, RunningProcess>()

  private getFFmpegPath(): string {
    const bundled = getBundledBinPath('ffmpeg')
    if (bundled) return bundled
    return findToolPath('ffmpeg') || 'ffmpeg'
  }

  private getFFprobePath(): string {
    const bundled = getBundledBinPath('ffprobe')
    if (bundled) return bundled
    return findToolPath('ffprobe') || 'ffprobe'
  }

  async ripTitlesFromVOB(params: {
    jobId: string
    discInfo: DiscInfo
    titleIds: number[]
    outputDir: string
    window: BrowserWindow
    onProgress?: (percentage: number, message: string) => void
  }): Promise<RipResult> {
    const { jobId, discInfo, titleIds, outputDir, window, onProgress } = params
    const outputFiles: string[] = []

    mkdirSync(outputDir, { recursive: true })

    // Find the mount point for the disc's VIDEO_TS directory
    const mountPoint = this.findDiscMountPoint(discInfo)
    if (!mountPoint) {
      return { success: false, outputFiles: [], error: 'Could not find disc mount point with VIDEO_TS directory' }
    }

    const videoTsDir = join(mountPoint, 'VIDEO_TS')
    log.info(`[ffmpeg-rip] Using VIDEO_TS at: ${videoTsDir}`)

    // Resolve which tracks to rip
    const selectedTracks = titleIds
      .map(id => discInfo.tracks.find(t => t.id === id))
      .filter((t): t is TrackInfo => t !== undefined)

    if (selectedTracks.length === 0) {
      return { success: false, outputFiles: [], error: 'No matching tracks found for the requested title IDs' }
    }

    // Map tracks to VTS numbers — try lsdvd vtsNumber first, then heuristic matching
    const trackVtsMap = await this.resolveVTSNumbers(selectedTracks, videoTsDir)

    // Deduplicate: if multiple tracks map to the same VTS, rip it only once
    const vtsToTracks = new Map<number, TrackInfo[]>()
    const unmappedTracks: TrackInfo[] = []

    for (const track of selectedTracks) {
      const vts = trackVtsMap.get(track.id)
      if (vts !== undefined) {
        const existing = vtsToTracks.get(vts) || []
        existing.push(track)
        vtsToTracks.set(vts, existing)
      } else {
        unmappedTracks.push(track)
      }
    }

    if (unmappedTracks.length > 0) {
      log.warn(`[ffmpeg-rip] Could not determine VTS for ${unmappedTracks.length} track(s): ${unmappedTracks.map(t => `title ${t.id}`).join(', ')}`)
    }

    if (vtsToTracks.size === 0) {
      return { success: false, outputFiles: [], error: 'Could not determine VTS numbers for any selected tracks. VOB fallback requires VTS mapping.' }
    }

    // Log deduplication
    for (const [vts, tracks] of vtsToTracks) {
      if (tracks.length > 1) {
        log.warn(`[ffmpeg-rip] VTS ${vts} maps to ${tracks.length} selected titles (${tracks.map(t => t.id).join(', ')}). ` +
          `Will rip VTS once — concat approach cannot distinguish program chains within a VTS.`)
      }
    }

    const totalVts = vtsToTracks.size
    let vtsIndex = 0
    const skippedVts: string[] = []

    for (const [vtsNumber, tracks] of vtsToTracks) {
      const vobFiles = this.findVOBFiles(videoTsDir, vtsNumber)
      if (vobFiles.length === 0) {
        log.warn(`[ffmpeg-rip] No VOB files found for VTS ${vtsNumber} — skipping`)
        skippedVts.push(`VTS ${vtsNumber}: no VOB files`)
        continue
      }

      // Pre-check: skip tiny VOBs that are likely menus or nav-only
      const totalVobSize = vobFiles.reduce((sum, f) => {
        try { return sum + statSync(f).size } catch { return sum }
      }, 0)
      if (totalVobSize < 65536) { // < 64KB
        log.warn(`[ffmpeg-rip] VTS ${vtsNumber}: total VOB size ${totalVobSize} bytes — too small, likely menu/nav-only, skipping`)
        skippedVts.push(`VTS ${vtsNumber}: too small (${totalVobSize} bytes)`)
        vtsIndex++
        continue
      }

      // Pre-check: verify VOB has video streams via ffprobe before committing to ffmpeg
      const hasVideo = await this.probeVOBHasVideo(vobFiles[0])
      if (!hasVideo) {
        log.warn(`[ffmpeg-rip] VTS ${vtsNumber}: no video stream detected in VOB — skipping`)
        skippedVts.push(`VTS ${vtsNumber}: no video stream`)
        vtsIndex++
        continue
      }

      // Use the first track's info for naming and duration estimation
      const primaryTrack = tracks[0]
      const outputFilename = `title_${String(primaryTrack.id).padStart(2, '0')}.mkv`
      const outputPath = join(outputDir, outputFilename)

      log.info(`[ffmpeg-rip] Ripping VTS ${vtsNumber}: ${vobFiles.length} VOB file(s), ${(totalVobSize / 1048576).toFixed(1)} MB → ${outputPath}`)
      log.info(`[ffmpeg-rip] VOB files: ${vobFiles.map(f => f.split('/').pop()).join(', ')}`)

      const result = await this.ripVOBsToMKV({
        jobId: `${jobId}_vts${vtsNumber}`,
        vobFiles,
        outputPath,
        expectedDuration: primaryTrack.durationSeconds,
        window,
        onProgress: onProgress
          ? (pct, msg) => {
              const overallPct = ((vtsIndex + pct / 100) / totalVts) * 100
              onProgress(overallPct, msg)
            }
          : undefined
      })

      if (result.success && result.outputFiles.length > 0) {
        outputFiles.push(...result.outputFiles)

        // Post-rip validation
        const valid = await this.validateOutput(result.outputFiles[0], primaryTrack.durationSeconds)
        if (!valid) {
          log.warn(`[ffmpeg-rip] Post-rip validation warning for ${outputFilename} — output may have issues`)
        }
      } else {
        // Non-fatal: log the error but continue with remaining VTSes
        log.warn(`[ffmpeg-rip] Failed to rip VTS ${vtsNumber} (non-fatal): ${result.error}`)
        skippedVts.push(`VTS ${vtsNumber}: ${result.error}`)
      }

      vtsIndex++
    }

    if (outputFiles.length === 0) {
      const skipDetail = skippedVts.length > 0 ? `. Skipped: ${skippedVts.join('; ')}` : ''
      return { success: false, outputFiles: [], error: `FFmpeg VOB rip produced no output files${skipDetail}` }
    }

    if (skippedVts.length > 0) {
      log.warn(`[ffmpeg-rip] ${skippedVts.length} VTS(es) skipped: ${skippedVts.join('; ')}`)
    }
    log.info(`[ffmpeg-rip] Complete — ${outputFiles.length} file(s) ripped via ffmpeg VOB fallback`)
    return { success: true, outputFiles }
  }

  // ─── VOB file discovery ─────────────────────────────────────────────

  private findVOBFiles(videoTsDir: string, vtsNumber: number): string[] {
    const prefix = `VTS_${String(vtsNumber).padStart(2, '0')}_`
    try {
      return readdirSync(videoTsDir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.VOB') && !f.endsWith('_0.VOB'))
        .sort()
        .map(f => join(videoTsDir, f))
    } catch (err) {
      log.error(`[ffmpeg-rip] Failed to read VIDEO_TS directory: ${err}`)
      return []
    }
  }

  // ─── Mount point discovery ──────────────────────────────────────────

  private findDiscMountPoint(discInfo: DiscInfo): string | null {
    // Try via disc-detection service first
    const dds = getDiscDetectionService()
    const mountPoint = dds.findMountPoint(discInfo.title)
    if (mountPoint) return mountPoint

    // Try additional variations
    const candidates = [
      `/Volumes/${discInfo.title}`,
      `/Volumes/${discInfo.title.replace(/\s+/g, '_')}`,
      `/Volumes/${discInfo.title.toUpperCase()}`,
      `/Volumes/${discInfo.title.toUpperCase().replace(/\s+/g, '_')}`
    ]
    for (const path of candidates) {
      if (existsSync(join(path, 'VIDEO_TS'))) return path
    }

    // Last resort: scan /Volumes for any mounted disc with VIDEO_TS
    try {
      const volumes = readdirSync('/Volumes')
      for (const vol of volumes) {
        const volPath = join('/Volumes', vol)
        if (existsSync(join(volPath, 'VIDEO_TS'))) {
          log.info(`[ffmpeg-rip] Found VIDEO_TS at fallback volume: ${volPath}`)
          return volPath
        }
      }
    } catch {}

    return null
  }

  // ─── VTS number resolution ──────────────────────────────────────────

  private async resolveVTSNumbers(
    tracks: TrackInfo[],
    videoTsDir: string
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>()

    // First: use vtsNumber from lsdvd if available
    let allHaveVts = true
    for (const track of tracks) {
      if (track.vtsNumber !== undefined) {
        result.set(track.id, track.vtsNumber)
      } else {
        allHaveVts = false
      }
    }

    if (allHaveVts) {
      log.info(`[ffmpeg-rip] All ${tracks.length} track(s) have VTS numbers from lsdvd`)
      return result
    }

    // Heuristic: match track durations against VTS VOB durations via ffprobe
    const unmapped = tracks.filter(t => !result.has(t.id))
    if (unmapped.length > 0) {
      log.info(`[ffmpeg-rip] ${unmapped.length} track(s) need heuristic VTS matching`)
      const vtsDurations = await this.probeVTSDurations(videoTsDir)

      // Log all VTS durations for debugging
      for (const [vts, dur] of vtsDurations) {
        log.info(`[ffmpeg-rip] VTS ${vts} probed duration: ${dur.toFixed(1)}s`)
      }

      for (const track of unmapped) {
        // 30s tolerance covers normal concat-vs-program-chain drift.
        // If this isn't enough, the largest-VTS fallback below handles it.
        const tolerance = 30
        let bestMatch: { vts: number; diff: number } | null = null

        for (const [vts, duration] of vtsDurations) {
          const diff = Math.abs(duration - track.durationSeconds)
          if (diff <= tolerance && (!bestMatch || diff < bestMatch.diff)) {
            bestMatch = { vts, diff }
          }
        }

        if (bestMatch) {
          result.set(track.id, bestMatch.vts)
          const vtsDur = vtsDurations.get(bestMatch.vts)!
          log.info(`[ffmpeg-rip] Heuristic match: title ${track.id} (${track.durationSeconds}s) → VTS ${bestMatch.vts} (${vtsDur.toFixed(1)}s, diff=${bestMatch.diff.toFixed(1)}s)`)
        } else {
          log.warn(`[ffmpeg-rip] No VTS duration match for title ${track.id} (${track.durationSeconds}s, tolerance=${tolerance.toFixed(0)}s)`)
        }
      }

      // Fallback: if still unmapped and only one track is selected, use the largest VTS.
      // The main feature is almost always the VTS with the most VOB data.
      const stillUnmapped = unmapped.filter(t => !result.has(t.id))
      if (stillUnmapped.length > 0 && vtsDurations.size > 0) {
        const largestVts = this.findLargestVTS(videoTsDir, vtsDurations)
        if (largestVts !== null) {
          for (const track of stillUnmapped) {
            result.set(track.id, largestVts.vts)
            log.info(`[ffmpeg-rip] Largest-VTS fallback: title ${track.id} (${track.durationSeconds}s) → VTS ${largestVts.vts} (${largestVts.sizeMB.toFixed(0)} MB, ${vtsDurations.get(largestVts.vts)?.toFixed(1)}s)`)
          }
        }
      }
    }

    // Last resort: file-enumeration fallback when all ffprobe probes failed.
    // Discovers VTS numbers purely from the filesystem (no ffprobe needed) and maps
    // tracks sequentially. This is the natural layout for TV show DVDs where each
    // episode is its own VTS, and also handles damaged discs where probing hangs.
    const finalUnmapped = tracks.filter(t => !result.has(t.id))
    if (finalUnmapped.length > 0) {
      const vtsEntries = this.enumerateVTSFromFiles(videoTsDir)
      // Exclude VTS numbers already assigned by earlier methods
      const assignedVts = new Set(result.values())
      const availableVts = vtsEntries.filter(e => !assignedVts.has(e.vts))

      if (availableVts.length > 0) {
        log.info(`[ffmpeg-rip] File-enumeration fallback: ${availableVts.length} non-trivial VTS(es) found, ${finalUnmapped.length} track(s) unmapped`)

        if (finalUnmapped.length === 1) {
          // Single track: use the largest available VTS by file size
          const largest = availableVts.reduce((a, b) => a.sizeMB > b.sizeMB ? a : b)
          result.set(finalUnmapped[0].id, largest.vts)
          log.info(`[ffmpeg-rip] File fallback: title ${finalUnmapped[0].id} → VTS ${largest.vts} (${largest.sizeMB.toFixed(0)} MB, largest by size)`)
        } else {
          // Multiple tracks: sequential assignment — TV DVDs typically lay out episodes in VTS order
          for (let i = 0; i < finalUnmapped.length && i < availableVts.length; i++) {
            result.set(finalUnmapped[i].id, availableVts[i].vts)
            log.info(`[ffmpeg-rip] File fallback: title ${finalUnmapped[i].id} → VTS ${availableVts[i].vts} (${availableVts[i].sizeMB.toFixed(0)} MB, sequential)`)
          }
          // If more tracks than VTS files, remaining tracks stay unmapped
          const remaining = finalUnmapped.length - availableVts.length
          if (remaining > 0) {
            log.warn(`[ffmpeg-rip] File fallback: ${remaining} track(s) still unmapped (more tracks than VTS files)`)
          }
        }
      }
    }

    return result
  }

  private async probeVTSDurations(videoTsDir: string): Promise<Map<number, number>> {
    const durations = new Map<number, number>()
    const ffprobe = this.getFFprobePath()

    // Find all VTS_XX_1.VOB files (first part of each VTS)
    let vobFiles: string[]
    try {
      vobFiles = readdirSync(videoTsDir)
        .filter(f => /^VTS_\d{2}_1\.VOB$/.test(f))
        .sort()
    } catch {
      return durations
    }

    for (const vobFile of vobFiles) {
      const vtsMatch = vobFile.match(/^VTS_(\d{2})_1\.VOB$/)
      if (!vtsMatch) continue
      const vtsNumber = parseInt(vtsMatch[1], 10)

      // Get all parts for this VTS to compute total duration
      const allParts = this.findVOBFiles(videoTsDir, vtsNumber)
      if (allParts.length === 0) continue

      // Use concat protocol for accurate total duration
      const concatInput = `concat:${allParts.join('|')}`

      try {
        const { stdout } = await execFileAsync(ffprobe, [
          '-hide_banner', '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'csv=p=0',
          concatInput
        ], { timeout: 15000 })

        const duration = parseFloat(stdout.trim())
        if (!isNaN(duration) && duration > 0) {
          durations.set(vtsNumber, duration)
          log.info(`[ffmpeg-rip] VTS ${vtsNumber}: ${duration.toFixed(1)}s (${allParts.length} parts)`)
        }
      } catch (err) {
        log.warn(`[ffmpeg-rip] Could not probe VTS ${vtsNumber}: ${err}`)
      }
    }

    return durations
  }

  /**
   * Find the VTS with the largest total VOB file size.
   * Used as a last-resort fallback when duration matching fails — the main
   * feature is almost always the VTS with the most data.
   */
  private findLargestVTS(videoTsDir: string, vtsDurations: Map<number, number>): { vts: number; sizeMB: number } | null {
    let largest: { vts: number; sizeMB: number } | null = null

    for (const [vts] of vtsDurations) {
      const vobFiles = this.findVOBFiles(videoTsDir, vts)
      const totalSize = vobFiles.reduce((sum, f) => {
        try { return sum + statSync(f).size } catch { return sum }
      }, 0)
      const sizeMB = totalSize / (1024 * 1024)

      if (!largest || sizeMB > largest.sizeMB) {
        largest = { vts, sizeMB }
      }
    }

    return largest
  }

  /**
   * Enumerate VTS numbers purely from filesystem (no ffprobe).
   * Used as last-resort fallback when probe-based matching fails entirely
   * (e.g. damaged disc causes ffprobe timeouts).
   * Returns VTS entries sorted by VTS number, filtered to skip tiny/menu VOBs.
   */
  private enumerateVTSFromFiles(videoTsDir: string): Array<{ vts: number; sizeMB: number }> {
    const entries: Array<{ vts: number; sizeMB: number }> = []

    try {
      const files = readdirSync(videoTsDir)
      const vtsStarters = files.filter(f => /^VTS_\d{2}_1\.VOB$/.test(f)).sort()

      for (const starter of vtsStarters) {
        const vtsMatch = starter.match(/^VTS_(\d{2})_1\.VOB$/)
        if (!vtsMatch) continue
        const vtsNumber = parseInt(vtsMatch[1], 10)

        const allParts = this.findVOBFiles(videoTsDir, vtsNumber)
        const totalSize = allParts.reduce((sum, f) => {
          try { return sum + statSync(f).size } catch { return sum }
        }, 0)
        const sizeMB = totalSize / (1024 * 1024)

        // Skip tiny VOBs — menus/nav are typically < 10MB
        if (sizeMB < 10) {
          log.info(`[ffmpeg-rip] File enum: VTS ${vtsNumber} skipped (${sizeMB.toFixed(1)} MB, likely menu)`)
          continue
        }

        log.info(`[ffmpeg-rip] File enum: VTS ${vtsNumber} — ${allParts.length} part(s), ${sizeMB.toFixed(0)} MB`)
        entries.push({ vts: vtsNumber, sizeMB })
      }
    } catch (err) {
      log.error(`[ffmpeg-rip] Failed to enumerate VTS files: ${err}`)
    }

    // Sort by VTS number (sequential assignment for TV episodes)
    entries.sort((a, b) => a.vts - b.vts)
    return entries
  }

  // ─── FFmpeg VOB → MKV ripping ──────────────────────────────────────

  private ripVOBsToMKV(params: {
    jobId: string
    vobFiles: string[]
    outputPath: string
    expectedDuration: number
    window: BrowserWindow
    onProgress?: (percentage: number, message: string) => void
  }): Promise<RipResult> {
    const { jobId, vobFiles, outputPath, expectedDuration, onProgress } = params
    const ffmpeg = this.getFFmpegPath()

    const concatInput = `concat:${vobFiles.join('|')}`

    const args = [
      '-y',
      '-fflags', '+discardcorrupt+genpts',
      '-analyzeduration', '100000000',
      '-probesize', '100000000',
      '-i', concatInput,
      '-map', '0:v',
      '-map', '0:a?',
      '-map', '0:s?',
      '-c', 'copy',
      '-progress', 'pipe:1',
      '-stats_period', '1',
      outputPath
    ]

    return new Promise((resolve) => {
      let lastSpeed: number | null = null
      const stderrLines: string[] = []
      let lastActivityTime = Date.now()
      let resolved = false

      const STALL_TIMEOUT_MS = 180_000 // 3 minutes with no progress = stalled

      const stallCheck = setInterval(() => {
        const silentMs = Date.now() - lastActivityTime
        if (silentMs >= STALL_TIMEOUT_MS && !resolved) {
          log.error(`[ffmpeg-rip] Aborting ${jobId}: no progress for ${Math.round(silentMs / 1000)}s, process appears stalled`)
          clearInterval(stallCheck)
          proc.kill()
        } else if (silentMs >= 30_000) {
          log.info(`[ffmpeg-rip] ${jobId} health: silent for ${Math.round(silentMs / 1000)}s`)
        }
      }, 15_000)

      const proc = runProcess({
        command: ffmpeg,
        args,
        onStdout: (line) => {
          // Parse progress from -progress pipe:1 output
          if (line.startsWith('out_time_us=') || line.startsWith('out_time_ms=')) {
            const value = parseInt(line.split('=')[1])
            if (!isNaN(value) && expectedDuration > 0) {
              lastActivityTime = Date.now()
              const currentSeconds = value / 1_000_000
              const pct = Math.min((currentSeconds / expectedDuration) * 100, 99.9)
              const speedStr = lastSpeed ? ` @ ${lastSpeed.toFixed(1)}x` : ''
              onProgress?.(pct, `FFmpeg VOB rip: ${pct.toFixed(0)}%${speedStr}`)
            }
          }
          if (line.includes('speed=')) {
            lastActivityTime = Date.now()
            const m = line.match(/speed=\s*([\d.]+)x/)
            if (m) lastSpeed = parseFloat(m[1])
          }
        },
        onStderr: (line) => {
          log.debug(`[ffmpeg-rip] ${line}`)
          stderrLines.push(line)
          // Also parse progress from stderr (ffmpeg sometimes reports there)
          if (line.includes('speed=')) {
            lastActivityTime = Date.now()
            const m = line.match(/speed=\s*([\d.]+)x/)
            if (m) lastSpeed = parseFloat(m[1])
          }
        },
        onExit: (code) => {
          resolved = true
          clearInterval(stallCheck)
          this.activeProcesses.delete(jobId)

          if (code === 0) {
            onProgress?.(100, 'FFmpeg VOB rip complete')
            log.info(`[ffmpeg-rip] FFmpeg succeeded: ${outputPath}`)
            resolve({ success: true, outputFiles: [outputPath] })
          } else {
            const lastStderr = stderrLines.slice(-10).join('\n')
            log.error(`[ffmpeg-rip] FFmpeg exited with code ${code}. Last stderr:\n${lastStderr}`)
            const errDetail = stderrLines.slice(-3).join(' | ').slice(0, 200)
            resolve({ success: false, outputFiles: [], error: `FFmpeg VOB rip exited with code ${code}: ${errDetail || 'no stderr output'}` })
          }
        }
      })

      this.activeProcesses.set(jobId, proc)
    })
  }

  // ─── VOB pre-check ──────────────────────────────────────────────────

  private async probeVOBHasVideo(vobPath: string): Promise<boolean> {
    const ffprobe = this.getFFprobePath()
    try {
      const { stdout } = await execFileAsync(ffprobe, [
        '-hide_banner', '-v', 'error',
        '-select_streams', 'v',
        '-show_entries', 'stream=codec_type',
        '-of', 'csv=p=0',
        vobPath
      ], { timeout: 10000 })
      return stdout.trim().includes('video')
    } catch {
      // ffprobe failed — VOB might still be valid, let ffmpeg try
      return true
    }
  }

  // ─── Post-rip validation ────────────────────────────────────────────

  private async validateOutput(outputPath: string, expectedDuration: number): Promise<boolean> {
    const ffprobe = this.getFFprobePath()

    try {
      const { stdout } = await execFileAsync(ffprobe, [
        '-hide_banner', '-v', 'error',
        '-show_entries', 'format=duration',
        '-show_entries', 'stream=codec_type',
        '-of', 'json',
        outputPath
      ], { timeout: 15000 })

      const data = JSON.parse(stdout)
      const duration = parseFloat(data.format?.duration || '0')
      const streams = (data.streams || []) as Array<{ codec_type: string }>
      const hasVideo = streams.some(s => s.codec_type === 'video')

      if (!hasVideo) {
        log.error(`[ffmpeg-rip] Validation failed: no video stream in ${outputPath}`)
        return false
      }

      // Check duration is within 10% of expected (or at least > 0)
      if (expectedDuration > 0) {
        const ratio = duration / expectedDuration
        if (ratio < 0.9 || ratio > 1.1) {
          log.warn(`[ffmpeg-rip] Validation warning: duration ${duration.toFixed(1)}s vs expected ${expectedDuration.toFixed(1)}s (ratio ${ratio.toFixed(2)})`)
          // Warn but don't fail — duration mismatches are common with concat rips
        }
      }

      log.info(`[ffmpeg-rip] Validation passed: ${outputPath} — ${duration.toFixed(1)}s, ${streams.length} stream(s), has video`)
      return true
    } catch (err) {
      log.warn(`[ffmpeg-rip] Validation probe failed: ${err}`)
      return false
    }
  }

  // ─── Cancellation ──────────────────────────────────────────────────

  cancelJob(jobId: string): boolean {
    // Try exact match first
    const proc = this.activeProcesses.get(jobId)
    if (proc) {
      log.info(`[ffmpeg-rip] Cancelling job ${jobId}`)
      proc.kill()
      this.activeProcesses.delete(jobId)
      return true
    }

    // Try prefix match (sub-jobs use jobId_vtsN format)
    let cancelled = false
    for (const [key, p] of this.activeProcesses) {
      if (key.startsWith(jobId)) {
        log.info(`[ffmpeg-rip] Cancelling sub-job ${key}`)
        p.kill()
        this.activeProcesses.delete(key)
        cancelled = true
      }
    }
    return cancelled
  }
}
