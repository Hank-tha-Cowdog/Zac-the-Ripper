import { join } from 'path'
import { getLogDir } from './log-paths'

/**
 * Path for a per-job, per-tool raw output transcript — the full
 * stdout+stderr a rip/encode tool produced, not just whatever filtered
 * subset reaches the app's own logger. Named by jobId (not the DB row id)
 * since jobId is what's already threaded through every service's rip/encode
 * methods; dbId isn't, and plumbing it through would be a much larger change
 * for the same practical benefit.
 */
export function getJobTranscriptPath(jobId: string, tool: string): string {
  const shortId = jobId.slice(0, 8)
  return join(getLogDir(), 'jobs', `${shortId}-${tool}.log`)
}
