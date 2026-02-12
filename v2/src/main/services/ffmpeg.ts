import { BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import type { Readable } from 'stream'
import { runProcess, RunningProcess } from '../util/process-runner'
import { getSetting } from '../database/queries/settings'
import { findToolPath, getBundledBinPath } from '../util/platform'
import { createLogger } from '../util/logger'
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

export interface PipeEncodeParams {
  jobId: string
  inputStream: Readable
  outputPath: string
  args: string[]
  estimatedDuration: number
  onProgress?: (percentage: number, speed: number | null, message: string) => void
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
            window.webContents.send(IPC.ENCODE_PROGRESS, {
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
            window.webContents.send(IPC.ENCODE_PROGRESS, {
              jobId, speed: lastSpeed,
              message: `Speed: ${match[1]}x`
            })
          }
        }
      }

      const proc = runProcess({
        command: ffmpeg,
        args: fullArgs,
        onStdout: handleProgress,
        onStderr: (line) => {
          handleProgress(line)
          log.debug(`FFmpeg: ${line}`)
        },
        onExit: (code) => {
          this.activeProcesses.delete(jobId)

          if (code === 0) {
            onProgress?.(100, lastSpeed)
            window.webContents.send(IPC.ENCODE_PROGRESS, {
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

  // parseProgress removed — logic inlined in encode() to support onProgress callback

  /**
   * Encode from a piped Readable stream (e.g. TailFileReader reading a growing MKV).
   * Progress is reported via the onProgress callback rather than IPC,
   * so the caller (pipeline) can manage unified progress.
   */
  async encodeFromPipe(params: PipeEncodeParams): Promise<{ success: boolean; error?: string }> {
    const { jobId, inputStream, outputPath, args, estimatedDuration, onProgress } = params
    const ffmpegPath = this.getFFmpegPath()

    const fullArgs = [
      '-y',
      '-analyzeduration', '100M',  // Read more data when probing pipe input
      '-probesize', '50M',         // Larger probe buffer for pipe demuxing
      '-f', 'matroska',            // Declare input format (reading MKV from pipe)
      '-i', 'pipe:0',             // Read from stdin
      '-progress', 'pipe:1',
      '-stats_period', '1',
      ...args,
      outputPath
    ]

    const pipeStartTs = Date.now()
    log.info(`[pipe] encodeFromPipe called at ${new Date(pipeStartTs).toISOString()}`)
    log.info(`[pipe] FFmpeg encode: ${ffmpegPath} ${fullArgs.join(' ')}`)
    log.info(`[pipe] Output: ${outputPath}`)
    log.info(`[pipe] Estimated duration: ${estimatedDuration.toFixed(1)}s`)

    return new Promise((resolve) => {
      const proc = spawn(ffmpegPath, fullArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let lastSpeed: number | null = null
      let stderrBuf = ''
      let stdoutBuf = ''
      let stderrFirstData = false
      const stderrLines: string[] = [] // Accumulate all stderr for error reporting

      // Pipe the input stream (TailFileReader) to FFmpeg's stdin
      inputStream.pipe(proc.stdin!)

      inputStream.on('error', (err) => {
        log.error(`[pipe] Input stream error: ${err.message}`)
        if (!proc.killed) proc.kill('SIGTERM')
      })

      proc.stdin!.on('error', (err) => {
        // EPIPE is expected if FFmpeg closes early (error or cancel)
        if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
          log.error(`[pipe] FFmpeg stdin error: ${err.message}`)
        }
      })

      proc.stdout!.on('data', (data: Buffer) => {
        stdoutBuf += data.toString()
        const lines = stdoutBuf.split('\n')
        stdoutBuf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          // Parse progress from -progress pipe:1 output
          if (line.startsWith('out_time_us=') || line.startsWith('out_time_ms=')) {
            const value = parseInt(line.split('=')[1])
            if (!isNaN(value) && estimatedDuration > 0) {
              const currentSec = value / 1_000_000
              const pct = Math.min((currentSec / estimatedDuration) * 100, 99.9)
              onProgress?.(pct, lastSpeed, `Encoding: ${pct.toFixed(1)}%`)
            }
          }
          if (line.includes('speed=')) {
            const m = line.match(/speed=\s*([\d.]+)x/)
            if (m) lastSpeed = parseFloat(m[1])
          }
        }
      })

      proc.stderr!.on('data', (data: Buffer) => {
        if (!stderrFirstData) {
          stderrFirstData = true
          log.info(`[pipe] FFmpeg stderr first data at t+${Date.now() - pipeStartTs}ms — FFmpeg is processing`)
        }
        stderrBuf += data.toString()
        const lines = stderrBuf.split('\n')
        stderrBuf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          stderrLines.push(line)
          log.debug(`[pipe] FFmpeg: ${line}`)
          // Also parse speed from stderr (FFmpeg reports it there)
          if (line.includes('speed=')) {
            const m = line.match(/speed=\s*([\d.]+)x/)
            if (m) lastSpeed = parseFloat(m[1])
          }
        }
      })

      proc.on('close', (code) => {
        this.activeProcesses.delete(jobId)
        if (code === 0) {
          log.info(`[pipe] FFmpeg encode complete: ${outputPath}`)
          onProgress?.(100, lastSpeed, 'Encoding complete')
          resolve({ success: true })
        } else {
          // Log all accumulated stderr at error level for debugging
          const lastStderr = stderrLines.slice(-30).join('\n')
          log.error(`[pipe] FFmpeg exited with code ${code}. Last ${Math.min(stderrLines.length, 30)} stderr lines:\n${lastStderr}`)
          const errMsg = `FFmpeg pipe encode failed (code ${code}): ${stderrLines.slice(-5).join(' | ')}`
          resolve({ success: false, error: errMsg })
        }
      })

      proc.on('error', (err) => {
        this.activeProcesses.delete(jobId)
        log.error(`[pipe] FFmpeg failed to start: ${err.message}`)
        resolve({ success: false, error: `FFmpeg failed to start: ${err.message}` })
      })

      // Store process for cancellation support
      this.activeProcesses.set(jobId, {
        pid: proc.pid || -1,
        process: proc,
        kill: () => {
          if (!proc.killed) {
            proc.kill('SIGTERM')
            setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 5000)
          }
        },
        waitForExit: () => new Promise(r => proc.on('close', r))
      })
    })
  }

  cancelJob(jobId: string): boolean {
    const proc = this.activeProcesses.get(jobId)
    if (proc) {
      // Send 'q' to FFmpeg for graceful stop
      proc.process.stdin?.write('q')
      setTimeout(() => {
        if (this.activeProcesses.has(jobId)) {
          proc.kill()
          this.activeProcesses.delete(jobId)
        }
      }, 5000)
      return true
    }
    return false
  }
}
