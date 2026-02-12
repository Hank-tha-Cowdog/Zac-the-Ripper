import { BrowserWindow } from 'electron'
import { readdirSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { runProcess, RunningProcess } from '../util/process-runner'
import { getSetting } from '../database/queries/settings'
import { findToolPath, getBundledBinPath } from '../util/platform'
import { createLogger } from '../util/logger'
import { IPC } from '../../shared/ipc-channels'

const log = createLogger('makemkv')

export interface RipProgress {
  jobId: string
  current: number
  total: number
  percentage: number
  title: string
  message: string
}

/** Expand leading ~ to the user's home directory */
function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1))
  }
  return p
}

export class MakeMKVService {
  private activeProcesses = new Map<string, RunningProcess>()

  private getMakeMKVPath(): string {
    const bundled = getBundledBinPath('makemkvcon')
    if (bundled) return bundled
    const settingPath = getSetting('tools.makemkvcon_path')
    if (settingPath) return settingPath
    return findToolPath('makemkvcon') || 'makemkvcon'
  }

  async ripTitles(params: {
    jobId: string
    discIndex: number
    titleIds: number[]
    outputDir: string
    window: BrowserWindow
    /** If provided, called with (overallPct, message) instead of sending IPC events */
    onProgress?: (percentage: number, message: string) => void
    /** If provided, called when the first MKV file is created in the output dir */
    onFileCreated?: (filePath: string) => void
  }): Promise<{ success: boolean; outputFiles: string[]; error?: string }> {
    const { jobId, discIndex, titleIds, window, onProgress, onFileCreated } = params
    const outputDir = expandPath(params.outputDir)
    const makemkvcon = this.getMakeMKVPath()
    const outputFiles: string[] = []
    const totalTitles = titleIds.length

    // Ensure output directory exists
    mkdirSync(outputDir, { recursive: true })

    for (let idx = 0; idx < titleIds.length; idx++) {
      const titleId = titleIds[idx]
      const result = await this.ripSingleTitle({
        jobId,
        discIndex,
        titleId,
        outputDir,
        window,
        makemkvcon,
        titleIndex: idx,
        totalTitles,
        onProgress,
        onFileCreated: idx === 0 ? onFileCreated : undefined // Only for first title
      })

      if (!result.success) {
        return { success: false, outputFiles, error: result.error }
      }

      if (result.outputFiles.length > 0) {
        outputFiles.push(...result.outputFiles)
      }
    }

    return { success: true, outputFiles }
  }

  private ripSingleTitle(params: {
    jobId: string
    discIndex: number
    titleId: number
    outputDir: string
    window: BrowserWindow
    makemkvcon: string
    titleIndex: number
    totalTitles: number
    onProgress?: (percentage: number, message: string) => void
    onFileCreated?: (filePath: string) => void
  }): Promise<{ success: boolean; outputFiles: string[]; error?: string }> {
    const { jobId, discIndex, titleId, outputDir, window, makemkvcon,
            titleIndex, totalTitles, onProgress, onFileCreated } = params

    // Snapshot existing .mkv files before ripping
    let existingFiles: Set<string>
    try {
      existingFiles = new Set(readdirSync(outputDir).filter(f => f.endsWith('.mkv')))
    } catch {
      existingFiles = new Set()
    }

    const titleLabel = totalTitles > 1 ? `Title ${titleIndex + 1}/${totalTitles}` : 'Ripping'
    let fileCreatedNotified = false

    return new Promise((resolve) => {
      let failed = false

      const proc = runProcess({
        command: makemkvcon,
        args: [
          '--robot',
          '--progress=-same',
          'mkv',
          `disc:${discIndex}`,
          String(titleId),
          outputDir
        ],
        onStdout: (line) => {
          // Parse PRGV: current, total, max (progress values)
          if (line.startsWith('PRGV:')) {
            const parts = line.substring(5).split(',')
            const current = parseInt(parts[0])
            const max = parseInt(parts[2])
            const titlePct = max > 0 ? (current / max) * 100 : 0
            // Overall progress across all titles
            const overallPct = ((titleIndex + titlePct / 100) / totalTitles) * 100

            if (onProgress) {
              onProgress(overallPct, `${titleLabel} — ${titlePct.toFixed(0)}%`)
            } else {
              window.webContents.send(IPC.RIP_PROGRESS, {
                jobId,
                current,
                total: max,
                percentage: overallPct,
                title: titleLabel,
                message: `${titleLabel} — ${titlePct.toFixed(0)}%`
              })
            }

            // Check for new file creation (for onFileCreated callback)
            if (onFileCreated && !fileCreatedNotified && titlePct > 0) {
              try {
                const newFile = readdirSync(outputDir)
                  .find(f => f.endsWith('.mkv') && !existingFiles.has(f))
                if (newFile) {
                  fileCreatedNotified = true
                  const filePath = join(outputDir, newFile)
                  log.info(`[rip] Detected new MKV file: ${filePath}`)
                  onFileCreated(filePath)
                }
              } catch { /* best-effort */ }
            }
          }

          // Parse PRGT: progress text
          if (line.startsWith('PRGT:')) {
            const match = line.match(/PRGT:\d+,\d+,"(.+)"/)
            if (match) log.info(`Progress: ${match[1]}`)
          }

          // Parse MSG: messages — detect failures
          if (line.startsWith('MSG:')) {
            const match = line.match(/MSG:\d+,\d+,\d+,"(.+)"/)
            if (match) {
              log.info(`MakeMKV: ${match[1]}`)
              if (match[1].includes('Failed to save title') || match[1].includes('0 titles saved')) {
                failed = true
              }
            }
          }
        },
        onStderr: (line) => {
          log.debug(`MakeMKV stderr: ${line}`)
        },
        onExit: (code) => {
          this.activeProcesses.delete(jobId)

          if (code !== 0) {
            resolve({ success: false, outputFiles: [], error: `MakeMKV exited with code ${code}` })
            return
          }

          // Detect new .mkv files by comparing directory listing
          let newFiles: string[] = []
          try {
            newFiles = readdirSync(outputDir)
              .filter(f => f.endsWith('.mkv') && !existingFiles.has(f))
              .map(f => join(outputDir, f))
          } catch (err) {
            log.warn(`Failed to scan output dir: ${err}`)
          }

          if (failed || newFiles.length === 0) {
            log.error(`MakeMKV reported success (code=0) but no new MKV files found for title ${titleId}`)
            resolve({
              success: false,
              outputFiles: [],
              error: `No output files created for title ${titleId}. Check that the output directory exists and is writable.`
            })
          } else {
            log.info(`Ripped title ${titleId}: ${newFiles.join(', ')}`)
            resolve({ success: true, outputFiles: newFiles })
          }
        }
      })

      this.activeProcesses.set(jobId, proc)
    })
  }

  async backup(params: {
    jobId: string
    discIndex: number
    outputDir: string
    window: BrowserWindow
  }): Promise<{ success: boolean; error?: string }> {
    const { jobId, discIndex, window } = params
    const outputDir = expandPath(params.outputDir)
    const makemkvcon = this.getMakeMKVPath()

    mkdirSync(outputDir, { recursive: true })

    return new Promise((resolve) => {
      const proc = runProcess({
        command: makemkvcon,
        args: [
          '--robot',
          '--progress=-same',
          'backup',
          '--decrypt',
          `disc:${discIndex}`,
          outputDir
        ],
        onStdout: (line) => {
          if (line.startsWith('PRGV:')) {
            const parts = line.substring(5).split(',')
            const current = parseInt(parts[0])
            const max = parseInt(parts[2])
            const percentage = max > 0 ? (current / max) * 100 : 0

            window.webContents.send(IPC.RIP_PROGRESS, {
              jobId,
              current,
              total: max,
              percentage,
              title: 'Raw Capture',
              message: 'Backing up disc structure...'
            })
          }
        },
        onExit: (code) => {
          this.activeProcesses.delete(jobId)
          if (code === 0) {
            resolve({ success: true })
          } else {
            resolve({ success: false, error: `MakeMKV backup exited with code ${code}` })
          }
        }
      })

      this.activeProcesses.set(jobId, proc)
    })
  }

  cancelJob(jobId: string): boolean {
    const proc = this.activeProcesses.get(jobId)
    if (proc) {
      proc.kill()
      this.activeProcesses.delete(jobId)
      return true
    }
    return false
  }
}
