import { BrowserWindow } from 'electron'
import { runProcess, RunningProcess } from '../util/process-runner'
import { getSetting } from '../database/queries/settings'
import { findToolPath, getBundledBinPath } from '../util/platform'
import { createLogger } from '../util/logger'
import { safeSend } from '../util/safe-send'
import { getJobTranscriptPath } from '../util/job-transcript'
import { IPC } from '../../shared/ipc-channels'

const log = createLogger('ffmpeg')

export interface EncodeParams {
  jobId: string
  inputPath: string
  outputPath: string
  args: string[]
  totalDuration: number
  window: BrowserWindow
  onProgress?: (percentage: number, speed: number | null) => void
}


export class FFmpegService {
  private activeProcesses = new Map<string, RunningProcess>()

  private getFFmpegPath(): string {
    const bundled = getBundledBinPath('ffmpeg')
    if (bundled) return bundled
    const settingPath = getSetting('tools.ffmpeg_path')
    if (settingPath) return settingPath
    return findToolPath('ffmpeg') || 'ffmpeg'
  }

  getPath(): string {
    return this.getFFmpegPath()
  }

  async encode(params: EncodeParams): Promise<{ success: boolean; error?: string }> {
    const { jobId, inputPath, outputPath, args, totalDuration, window, onProgress } = params
    const ffmpeg = this.getFFmpegPath()

    const fullArgs = [
      '-y',
      '-i', inputPath,
      '-progress', 'pipe:1',
      '-stats_period', '1',
      ...args,
      outputPath
    ]

    return new Promise((resolve) => {
      let lastSpeed: number | null = null

      const handleProgress = (line: string) => {
        // Parse percentage from progress output
        if (line.startsWith('out_time_us=') || line.startsWith('out_time_ms=')) {
          const value = parseInt(line.split('=')[1])
          if (!isNaN(value) && totalDuration > 0) {
            const currentSeconds = value / 1000000
            const percentage = Math.min((currentSeconds / totalDuration) * 100, 99.9)
            onProgress?.(percentage, lastSpeed)
            safeSend(window, IPC.ENCODE_PROGRESS, {
              jobId, percentage,
              currentTime: currentSeconds, totalDuration,
              message: `Encoding... ${percentage.toFixed(1)}%`
            })
          }
        }
        if (line.includes('speed=')) {
          const match = line.match(/speed=\s*([\d.]+)x/)
          if (match) {
            lastSpeed = parseFloat(match[1])
            safeSend(window, IPC.ENCODE_PROGRESS, {
              jobId, speed: lastSpeed,
              message: `Speed: ${match[1]}x`
            })
          }
        }
      }

      const proc = runProcess({
        command: ffmpeg,
        args: fullArgs,
        transcriptPath: getJobTranscriptPath(jobId, 'ffmpeg'),
        onStdout: handleProgress,
        onStderr: (line) => {
          handleProgress(line)
          log.debug(`FFmpeg: ${line}`)
        },
        onExit: (code) => {
          this.activeProcesses.delete(jobId)

          if (code === 0) {
            onProgress?.(100, lastSpeed)
            safeSend(window, IPC.ENCODE_PROGRESS, {
              jobId,
              percentage: 100,
              message: 'Encoding complete'
            })
            resolve({ success: true })
          } else {
            resolve({ success: false, error: `FFmpeg exited with code ${code}` })
          }
        }
      })

      this.activeProcesses.set(jobId, proc)
    })
  }

  cancelJob(jobId: string): boolean {
    // Exact match covers standalone encode jobs; prefix match covers pipeline
    // sub-encodes registered as `${jobId}_ep_${n}` (TV episodes) and
    // `${jobId}_extra_${n}` (extras) — without this, cancelling a pipeline job
    // only stops whichever sub-encode happens to share the exact jobId.
    const matches: Array<[string, RunningProcess]> = []
    for (const [key, proc] of this.activeProcesses) {
      if (key === jobId || key.startsWith(jobId + '_')) matches.push([key, proc])
    }
    if (matches.length === 0) return false

    for (const [key, proc] of matches) {
      // Send 'q' to FFmpeg for graceful stop
      proc.process.stdin?.write('q')
      setTimeout(() => {
        if (this.activeProcesses.has(key)) {
          proc.kill()
          this.activeProcesses.delete(key)
        }
      }, 5000)
    }
    return true
  }

  /** Kill every active ffmpeg process immediately — used on app quit, where
   * waiting for cancelJob's graceful 'q'-then-5s-wait dance isn't appropriate. */
  killAll(): void {
    for (const [key, proc] of this.activeProcesses) {
      proc.kill()
      this.activeProcesses.delete(key)
    }
  }
}
