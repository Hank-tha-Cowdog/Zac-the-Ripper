import { getLogDir } from './log-paths'
import { RotatingFile } from './rotating-file'

/**
 * Structured, machine-readable job/app lifecycle events — the JSONL
 * counterpart to logger.ts's human-readable main.log. Designed to be tailed:
 * `tail -f events.jsonl | jq` reconstructs what the app is doing without
 * needing the UI. Each line is one JSON object: {ts, event, ...data}.
 */

export type EventType =
  | 'app_start'
  | 'app_quit'
  | 'disc_detected'
  | 'disc_ejected'
  | 'job_created'
  | 'phase_changed'
  | 'progress'
  | 'read_error'
  | 'watchdog_kill'
  | 'job_completed'
  | 'job_failed'
  | 'job_cancelled'
  | 'heartbeat'
  | 'crash'

let sink: RotatingFile | null = null
let dirOverride: string | null = null

function getSink(): RotatingFile {
  if (!sink) sink = new RotatingFile(dirOverride ?? getLogDir(), 'events.jsonl', 20 * 1024 * 1024)
  return sink
}

/** Test-only escape hatch, mirrors logger.ts's _setLogDirForTesting. */
export function _setEventLogDirForTesting(dir: string | null): void {
  dirOverride = dir
  sink = null
}

export function logEvent(event: EventType, data: Record<string, unknown> = {}): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data })
    getSink().append(line)
  } catch {
    // Never let event logging itself crash the app it's observing — e.g. a
    // circular reference in `data` (a caught error object, say) would throw
    // in JSON.stringify.
  }
}
