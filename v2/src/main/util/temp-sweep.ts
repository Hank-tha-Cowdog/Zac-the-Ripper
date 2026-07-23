import { tmpdir } from 'os'
import { join } from 'path'
import { readdirSync, rmSync, statSync } from 'fs'
import { createLogger } from './logger'

const log = createLogger('temp-sweep')

// Every prefix this app uses under tmpdir() for staging/artwork during a rip.
// A crash or force-quit mid-job leaves these behind with no owner to clean
// them up — over a long multi-hundred-disc session that's tens of GB wasted.
const ZTR_TEMP_PREFIXES = ['ztr_stage_', 'ztr_music_', 'ztr_poster_', 'ztr_fanart_']

/**
 * Remove leftover ztr_* staging/artwork temp files from previous sessions.
 * Safe to call at startup: any active job's temp dir would have been created
 * by *this* process, so anything found here predates the current process.
 */
export function sweepStaleTempFiles(): void {
  let removed = 0
  let bytesFreed = 0

  try {
    const entries = readdirSync(tmpdir())
    for (const entry of entries) {
      if (!ZTR_TEMP_PREFIXES.some(prefix => entry.startsWith(prefix))) continue

      const fullPath = join(tmpdir(), entry)
      try {
        const stat = statSync(fullPath)
        bytesFreed += stat.isDirectory() ? dirSize(fullPath) : stat.size
        rmSync(fullPath, { recursive: true, force: true })
        removed++
      } catch (err) {
        log.warn(`Failed to remove stale temp entry ${fullPath}: ${err}`)
      }
    }
  } catch (err) {
    log.warn(`Failed to scan ${tmpdir()} for stale temp files: ${err}`)
  }

  if (removed > 0) {
    log.info(`Swept ${removed} stale temp entr${removed === 1 ? 'y' : 'ies'} (${(bytesFreed / 1048576).toFixed(1)} MB) from a previous session`)
  }
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      total += entry.isDirectory() ? dirSize(fullPath) : statSync(fullPath).size
    }
  } catch {
    // Best-effort size estimate for logging only — ignore unreadable entries
  }
  return total
}
