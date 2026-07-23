import { existsSync, mkdirSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { getLogDir } from './log-paths'

export interface StatusJobEntry {
  jobId: string
  dbId: number
  type: string
  status: string
  progress?: number
  message?: string
}

export interface StatusSnapshot {
  pid: number
  version: string
  startedAt: string
  updatedAt: string
  activeJobs: StatusJobEntry[]
  lastError: string | null
}

let dirOverride: string | null = null
let lastError: string | null = null
const startedAt = new Date().toISOString()

/** Test-only escape hatch, mirrors logger.ts's _setLogDirForTesting. */
export function _setStatusDirForTesting(dir: string | null): void {
  dirOverride = dir
  lastError = null
}

export function recordLastError(message: string): void {
  lastError = message
}

/**
 * Atomically overwrite status.json with the current app/job state. A
 * supervising process can read this at any moment to see "what's happening
 * right now" — pid, uptime, and every active job's phase/progress — without
 * needing to reconstruct it from the JSONL event stream. Written on a
 * heartbeat interval and after any meaningful job state change.
 *
 * "Atomic" here means write-to-temp-then-rename, so a reader never observes
 * a half-written file (rename is atomic on the same filesystem, unlike
 * writeFileSync directly to the target, which a concurrent read could catch
 * mid-write).
 */
export function writeStatusSnapshot(activeJobs: StatusJobEntry[], version: string): void {
  const snapshot: StatusSnapshot = {
    pid: process.pid,
    version,
    startedAt,
    updatedAt: new Date().toISOString(),
    activeJobs,
    lastError
  }

  const dir = dirOverride ?? getLogDir()
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const target = join(dir, 'status.json')
    const tmp = `${target}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2))
    renameSync(tmp, target)
  } catch {
    // Status snapshotting must never crash the app it's observing.
  }
}
