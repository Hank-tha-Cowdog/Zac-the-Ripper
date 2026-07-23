import { BrowserWindow } from 'electron'
import { readdirSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
import { runProcess, RunningProcess } from '../util/process-runner'
import { getSetting } from '../database/queries/settings'
import { findToolPath, getBundledBinPath } from '../util/platform'
import { createLogger } from '../util/logger'
import { safeSend } from '../util/safe-send'
import { getJobTranscriptPath } from '../util/job-transcript'
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

export interface ReadError {
  file: string      // e.g. "/VIDEO_TS/VTS_02_1.VOB"
  offset: string    // e.g. "116785152"
  errorType: string // e.g. "HARDWARE ERROR:TIMEOUT ON LOGICAL UNIT"
}

export interface RipResult {
  success: boolean
  outputFiles: string[]
  error?: string
  readErrors?: ReadError[]
  cancelled?: boolean
  /**
   * Explicit titleId → output file path, alongside the flat outputFiles
   * list. Consumers that need to associate a specific ripped file with the
   * title it came from (TV episode numbering, extras naming) previously had
   * to either pair outputFiles with the *requested* titleIds by array
   * position — which silently mislabels everything after a skipped/failed
   * title — or reconstruct the mapping by regex-parsing MakeMKV's own
   * output filenames, which doesn't match every naming convention (notably
   * the ffmpeg VOB fallback's). This is populated directly from what was
   * actually ripped, so it's correct even when some requested titles failed.
   */
  titleFiles?: Array<{ titleId: number; filePath: string }>
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
  // ripTitles() rips multiple titles sequentially, reusing the same jobId key
  // in activeProcesses for each one — killing the in-flight process for a
  // cancelled job isn't enough on its own, since the loop would just move on
  // to the next title. This flag lets the loop check "was this job cancelled"
  // between titles and stop instead.
  private cancelledJobIds = new Set<string>()

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
  }): Promise<RipResult> {
    const { jobId, discIndex, titleIds, window, onProgress, onFileCreated } = params
    const outputDir = expandPath(params.outputDir)
    const makemkvcon = this.getMakeMKVPath()
    const outputFiles: string[] = []
    const titleFiles: Array<{ titleId: number; filePath: string }> = []
    const allReadErrors: ReadError[] = []
    const totalTitles = titleIds.length

    // Ensure output directory exists
    mkdirSync(outputDir, { recursive: true })

    const failedTitles: Array<{ titleId: number; error: string }> = []
    let cancelled = false

    for (let idx = 0; idx < titleIds.length; idx++) {
      if (this.cancelledJobIds.has(jobId)) {
        log.info(`[rip] Job ${jobId} cancelled — stopping before title ${titleIds[idx]} (${idx}/${totalTitles} done)`)
        cancelled = true
        break
      }

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

      // Collect read errors from this title
      if (result.readErrors && result.readErrors.length > 0) {
        allReadErrors.push(...result.readErrors)
      }

      if (!result.success) {
        if (this.cancelledJobIds.has(jobId)) {
          // This title failed because cancelJob() killed it mid-rip, not because
          // of a real disc/tool error — stop here instead of treating it as a
          // per-title failure and moving on to the next one.
          log.info(`[rip] Job ${jobId} cancelled mid-title ${titleId} — stopping`)
          cancelled = true
          break
        }
        // Don't abort — continue with remaining titles so partial results are preserved.
        // TV DVDs often include a "play all" title that MakeMKV can't handle, but
        // individual episode titles extract fine.
        log.warn(`[rip] Title ${titleId} failed: ${result.error} — continuing with remaining titles`)
        failedTitles.push({ titleId, error: result.error || 'Unknown error' })
        continue
      }

      if (result.outputFiles.length > 0) {
        outputFiles.push(...result.outputFiles)
        // ripSingleTitle produces exactly one file per title in practice;
        // associate all (just in case) with this loop's titleId, which is
        // known-correct regardless of what MakeMKV named the file.
        for (const filePath of result.outputFiles) {
          titleFiles.push({ titleId, filePath })
        }
      }
    }

    // Log read error summary if any occurred
    if (allReadErrors.length > 0) {
      const affectedFiles = [...new Set(allReadErrors.map(e => e.file))]
      log.warn(`[rip] Completed with ${allReadErrors.length} read error(s) across ${affectedFiles.length} file(s): ${affectedFiles.join(', ')}`)
    }

    if (failedTitles.length > 0) {
      log.warn(`[rip] ${failedTitles.length} of ${totalTitles} title(s) failed: ${failedTitles.map(f => `title ${f.titleId}`).join(', ')}`)
    }

    this.cancelledJobIds.delete(jobId)

    // Report success if ANY titles were extracted — partial results are usable
    const overallSuccess = outputFiles.length > 0
    const error = failedTitles.length > 0
      ? `${failedTitles.length} of ${totalTitles} title(s) failed: ${failedTitles.map(f => f.error).join('; ')}`
      : undefined
    return { success: overallSuccess, outputFiles, titleFiles, readErrors: allReadErrors, error, cancelled }
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
  }): Promise<RipResult> {
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

    // ── Read error tracking ──────────────────────────────────────────
    // MakeMKV retries bad sectors before moving on. We track all errors
    // and report them after completion. Only abort if progress truly
    // stalls (process stuck) or the disc is extremely damaged.
    const MAX_TOTAL_ERRORS = 100       // Abort threshold for severely damaged discs
    const PROGRESS_STALL_IDLE_MS = 5 * 60 * 1000   // 5 min no-output + idle CPU = stuck
    const PROGRESS_STALL_ACTIVE_MS = 15 * 60 * 1000 // 15 min no-output but active CPU = safety cap
    const HEALTH_CHECK_INTERVAL_MS = 15000    // Check process health every 15s
    const ZERO_CPU_KILL_COUNT = 3             // Kill after 3 consecutive 0% CPU readings
    const ZERO_CPU_SILENCE_GATE_MS = 60000    // AND at least 60s of no progress

    return new Promise((resolve) => {
      let failed = false
      let lastProgressTime = Date.now()
      let healthTimer: ReturnType<typeof setInterval> | null = null
      let consecutiveZeroCpu = 0
      let gotFirstProgress = false  // Track if we've received any PRGV line
      const readErrors: ReadError[] = []

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
        transcriptPath: getJobTranscriptPath(jobId, 'makemkv'),
        onStdout: (line) => {
          // Parse PRGV: current, total, max — current is scoped to whatever
          // sub-operation MakeMKV is in right now (analyze, save, ...) and
          // resets to 0 at each transition; total is scoped to the whole
          // task and increases monotonically. Using current/max here made
          // the reported percentage visibly jump backwards at every
          // operation boundary; total/max doesn't.
          if (line.startsWith('PRGV:')) {
            const parts = line.substring(5).split(',')
            const current = parseInt(parts[0])
            const total = parseInt(parts[1])
            const max = parseInt(parts[2])
            if (!Number.isFinite(current) || !Number.isFinite(total) || !Number.isFinite(max)) return
            const titlePct = max > 0 ? (total / max) * 100 : 0
            // Overall progress across all titles
            const overallPct = ((titleIndex + titlePct / 100) / totalTitles) * 100

            // Any progress update means MakeMKV is still working
            lastProgressTime = Date.now()
            gotFirstProgress = true
            consecutiveZeroCpu = 0  // Reset — process is clearly alive

            const errorSuffix = readErrors.length > 0 ? ` (${readErrors.length} read errors)` : ''
            if (onProgress) {
              onProgress(overallPct, `${titleLabel} — ${titlePct.toFixed(0)}%${errorSuffix}`)
            } else {
              safeSend(window, IPC.RIP_PROGRESS, {
                jobId,
                current,
                total: max,
                percentage: overallPct,
                title: titleLabel,
                message: `${titleLabel} — ${titlePct.toFixed(0)}%${errorSuffix}`
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

          // Parse MSG: messages — detect failures and track read errors
          if (line.startsWith('MSG:')) {
            const match = line.match(/MSG:\d+,\d+,\d+,"(.+)"/)
            if (match) {
              const msgText = match[1]
              log.info(`MakeMKV: ${msgText}`)

              if (msgText.includes('Failed to save title') || msgText.includes('0 titles saved')) {
                failed = true
              }

              // Track read errors — parse file path and offset from MakeMKV error messages
              // Format: "Error 'TYPE' occurred while reading 'FILE' at offset 'OFFSET'"
              const errorMatch = msgText.match(/Error '([^']+)' occurred while reading '([^']+)' at offset '([^']+)'/)
              if (errorMatch) {
                const [, errorType, file, offset] = errorMatch
                readErrors.push({ file, offset, errorType })

                // Also count as activity — MakeMKV is working, just hitting bad sectors
                lastProgressTime = Date.now()

                if (readErrors.length <= 10 || readErrors.length % 10 === 0) {
                  log.warn(`[rip] Read error #${readErrors.length}: ${errorType} on ${file} @ offset ${offset}`)
                }

                // Abort only on extreme damage — disc is basically destroyed
                if (readErrors.length >= MAX_TOTAL_ERRORS) {
                  log.error(`[rip] Aborting: ${readErrors.length} total read errors — disc is severely damaged`)
                  failed = true
                  proc.kill()
                }
              }
            }
          }
        },
        onStderr: (line) => {
          log.debug(`MakeMKV stderr: ${line}`)
        },
        onExit: (code) => {
          if (healthTimer) clearInterval(healthTimer)
          this.activeProcesses.delete(jobId)

          // Log read error summary
          if (readErrors.length > 0) {
            const affectedFiles = [...new Set(readErrors.map(e => e.file))]
            log.warn(`[rip] Title ${titleId} finished with ${readErrors.length} read error(s) in: ${affectedFiles.join(', ')}`)
          }

          if (failed && readErrors.length >= MAX_TOTAL_ERRORS) {
            resolve({
              success: false,
              outputFiles: [],
              readErrors,
              error: `Disc is severely damaged: ${readErrors.length} read errors on title ${titleId}. Affected files: ${[...new Set(readErrors.map(e => e.file))].join(', ')}`
            })
            return
          }

          if (code !== 0 && !failed) {
            resolve({ success: false, outputFiles: [], readErrors, error: `MakeMKV exited with code ${code}` })
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
            const reason = failed
              ? `Rip failed on title ${titleId} with ${readErrors.length} read error(s). The disc may be scratched or damaged.`
              : `No output files created for title ${titleId}. Check that the output directory exists and is writable.`
            log.error(`MakeMKV failed for title ${titleId}: ${reason}`)
            resolve({ success: false, outputFiles: [], readErrors, error: reason })
          } else {
            log.info(`Ripped title ${titleId}: ${newFiles.join(', ')}`)
            resolve({ success: true, outputFiles: newFiles, readErrors })
          }
        }
      })

      this.activeProcesses.set(jobId, proc)

      // Health watchdog — monitors both output stall AND CPU usage.
      // A deadlocked MakeMKV (confirmed v1.18.3 bug) shows 0% CPU immediately
      // after "Using direct disc access mode". A legitimate rip always has CPU
      // activity from disc I/O and decryption. CPU monitoring detects deadlocks
      // in ~60s; the stall timeout is a safety net for other failure modes.
      healthTimer = setInterval(async () => {
        const stalledMs = Date.now() - lastProgressTime
        const stalledSec = Math.round(stalledMs / 1000)

        // Safety net: stall timeout with CPU-awareness.
        // If CPU is idle (consecutiveZeroCpu > 0): kill after 5 min — likely deadlocked.
        // If CPU is active (consecutiveZeroCpu === 0): wait up to 15 min — MakeMKV is
        // probably reading disc structure or handling a large title.
        const effectiveStallMs = consecutiveZeroCpu > 0 ? PROGRESS_STALL_IDLE_MS : PROGRESS_STALL_ACTIVE_MS
        if (stalledMs >= effectiveStallMs) {
          const reason = consecutiveZeroCpu > 0
            ? `no activity for ${(stalledMs / 60000).toFixed(0)} min with idle CPU — process appears stuck`
            : `no output for ${(stalledMs / 60000).toFixed(0)} min despite active CPU — safety timeout reached`
          log.error(`[rip] Aborting title ${titleId}: ${reason}`)
          failed = true
          proc.kill()
          return
        }

        // CPU-based health check — detect deadlocks when process is silent for 30s+
        // Three consecutive 0% CPU readings (~45s) means true deadlock; counter resets on every PRGV
        if (stalledMs >= 30000 && proc.pid > 0) {
          try {
            const { stdout } = await execAsync(`ps -p ${proc.pid} -o %cpu=,rss=,state=`)
            const parts = stdout.trim().split(/\s+/)
            const cpu = parseFloat(parts[0] || '0')
            const rssMb = Math.round(parseInt(parts[1] || '0', 10) / 1024)
            const state = parts[2] || '?'

            log.info(`[rip] Title ${titleId} health: pid=${proc.pid} cpu=${cpu}% mem=${rssMb}MB state=${state} silent=${stalledSec}s`)

            if (cpu < 0.5) {
              consecutiveZeroCpu++
            } else {
              consecutiveZeroCpu = 0
            }

            // Kill after N consecutive 0% CPU readings AND sufficient silence
            if (consecutiveZeroCpu >= ZERO_CPU_KILL_COUNT && stalledMs >= ZERO_CPU_SILENCE_GATE_MS) {
              log.error(`[rip] Aborting title ${titleId}: process appears deadlocked (0% CPU for ${consecutiveZeroCpu * (HEALTH_CHECK_INTERVAL_MS / 1000)}s, silent for ${stalledSec}s)`)
              failed = true
              proc.kill()
              return
            }
          } catch {
            log.warn(`[rip] Could not check process health for title ${titleId} (pid=${proc.pid}, may have exited)`)
          }
        } else if (stalledMs >= 60000) {
          log.info(`[rip] Title ${titleId}: waiting for MakeMKV (silent for ${stalledSec}s, gotProgress=${gotFirstProgress})`)
        }
      }, HEALTH_CHECK_INTERVAL_MS)
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
        transcriptPath: getJobTranscriptPath(jobId, 'makemkv-backup'),
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
            const total = parseInt(parts[1])
            const max = parseInt(parts[2])
            if (!Number.isFinite(current) || !Number.isFinite(total) || !Number.isFinite(max)) return
            // See the ripSingleTitle PRGV comment above: total/max tracks
            // the whole task, current/max resets at every sub-operation.
            const percentage = max > 0 ? (total / max) * 100 : 0

            safeSend(window, IPC.RIP_PROGRESS, {
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
          const wasCancelled = this.cancelledJobIds.has(jobId)
          this.cancelledJobIds.delete(jobId)
          if (code === 0) {
            resolve({ success: true })
          } else if (wasCancelled) {
            resolve({ success: false, error: 'Cancelled' })
          } else {
            resolve({ success: false, error: `MakeMKV backup exited with code ${code}` })
          }
        }
      })

      this.activeProcesses.set(jobId, proc)
    })
  }

  cancelJob(jobId: string): boolean {
    this.cancelledJobIds.add(jobId)
    const proc = this.activeProcesses.get(jobId)
    if (proc) {
      proc.kill()
      this.activeProcesses.delete(jobId)
      return true
    }
    // No process currently active for this jobId (e.g. between titles in
    // ripTitles' loop) — still record the cancellation so the loop stops
    // before starting the next title.
    return false
  }

  /** Kill every active makemkvcon process immediately — used on app quit. */
  killAll(): void {
    for (const [jobId, proc] of this.activeProcesses) {
      this.cancelledJobIds.add(jobId)
      proc.kill()
      this.activeProcesses.delete(jobId)
    }
  }
}
