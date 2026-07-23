import { getDb } from '../connection'
import { logEvent } from '../../util/event-log'

export interface JobRow {
  id: number
  disc_id: number | null
  job_type: string
  status: string
  progress: number
  input_path: string | null
  output_path: string | null
  encoding_preset: string | null
  error_message: string | null
  movie_title: string | null
  poster_url: string | null
  started_at: string | null
  completed_at: string | null
  duration_seconds: number | null
  created_at: string
  updated_at: string
}

export interface JobListFilters {
  discId?: number
  status?: string
  /** Case-insensitive substring match against movie title, disc title, or output path. */
  search?: string
  limit?: number
  offset?: number
}

const DEFAULT_JOB_LIST_LIMIT = 50

export function buildJobListWhere(filters?: JobListFilters): { where: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.discId) {
    conditions.push('jobs.disc_id = ?')
    params.push(filters.discId)
  }
  if (filters?.status) {
    conditions.push('jobs.status = ?')
    params.push(filters.status)
  }
  if (filters?.search) {
    conditions.push('(jobs.movie_title LIKE ? OR discs.title LIKE ? OR jobs.output_path LIKE ?)')
    const like = `%${filters.search}%`
    params.push(like, like, like)
  }

  return { where: conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '', params }
}

/**
 * Bounded by default (DEFAULT_JOB_LIST_LIMIT) — at "hundreds of discs"
 * scale, each disc can spawn several job rows (rip + follow-on encodes +
 * extras), and an unbounded SELECT * serialized whole across IPC on every
 * History page load/filter change gets slower forever as history
 * accumulates. Pass a higher `limit` explicitly for callers that
 * genuinely need more (e.g. export).
 */
export function listJobs(filters?: JobListFilters): (JobRow & { disc_title?: string })[] {
  const { where, params } = buildJobListWhere(filters)
  const limit = filters?.limit ?? DEFAULT_JOB_LIST_LIMIT
  const offset = filters?.offset ?? 0

  const sql = `SELECT jobs.*, discs.title AS disc_title FROM jobs LEFT JOIN discs ON jobs.disc_id = discs.id${where} ORDER BY jobs.created_at DESC LIMIT ? OFFSET ?`

  return getDb().prepare(sql).all(...params, limit, offset) as (JobRow & { disc_title?: string })[]
}

/** Total row count for the same filters listJobs() would apply — pairs with it for "Page X of Y" pagination UI. */
export function countJobs(filters?: Pick<JobListFilters, 'discId' | 'status' | 'search'>): number {
  const { where, params } = buildJobListWhere(filters)
  const sql = `SELECT COUNT(*) as count FROM jobs LEFT JOIN discs ON jobs.disc_id = discs.id${where}`
  const row = getDb().prepare(sql).get(...params) as { count: number }
  return row.count
}

export function getJob(id: number): JobRow | undefined {
  return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
}

export function createJob(data: {
  disc_id?: number
  job_type: string
  input_path?: string
  output_path?: string
  encoding_preset?: string
  movie_title?: string
  poster_url?: string
}): JobRow {
  const result = getDb().prepare(`
    INSERT INTO jobs (disc_id, job_type, status, input_path, output_path, encoding_preset, movie_title, poster_url)
    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(
    data.disc_id ?? null,
    data.job_type,
    data.input_path ?? null,
    data.output_path ?? null,
    data.encoding_preset ?? null,
    data.movie_title ?? null,
    data.poster_url ?? null
  )

  const job = getJob(Number(result.lastInsertRowid))!
  logEvent('job_created', { dbId: job.id, jobType: job.job_type, discId: job.disc_id, movieTitle: job.movie_title })
  return job
}

export function updateJobStatus(id: number, status: string, extra?: {
  progress?: number
  error_message?: string
  output_path?: string
}): void {
  const fields = ["status = ?", "updated_at = datetime('now')"]
  const values: unknown[] = [status]

  if (status === 'running' && !extra?.progress) {
    fields.push("started_at = datetime('now')")
  }
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    fields.push("completed_at = datetime('now')")
    fields.push("duration_seconds = CAST((julianday(datetime('now')) - julianday(started_at)) * 86400 AS REAL)")
  }
  if (extra?.progress !== undefined) {
    fields.push('progress = ?')
    values.push(extra.progress)
  }
  if (extra?.error_message) {
    fields.push('error_message = ?')
    values.push(extra.error_message)
  }
  if (extra?.output_path) {
    fields.push('output_path = ?')
    values.push(extra.output_path)
  }

  // Once a job is cancelled, no later status transition may overwrite that —
  // otherwise a pipeline that keeps running after cancelJob() (cooperative
  // cancellation isn't instantaneous) can flip the row back to 'completed' or
  // 'failed' by the time it finally unwinds, hiding that it was cancelled.
  values.push(id, status)
  const result = getDb().prepare(
    `UPDATE jobs SET ${fields.join(', ')} WHERE id = ? AND (status != 'cancelled' OR ? = 'cancelled')`
  ).run(...values)

  // Progress-only updates (status stays 'running' with a percentage attached)
  // are frequent — logging every one would flood events.jsonl. Only log
  // discrete lifecycle transitions: the first move into 'running', and every
  // terminal state. Live progress belongs in status.json, not this stream.
  if (result.changes > 0) {
    if (status === 'running' && !extra?.progress) {
      logEvent('phase_changed', { dbId: id, phase: 'running' })
    } else if (status === 'completed') {
      logEvent('job_completed', { dbId: id, outputPath: extra?.output_path })
    } else if (status === 'failed') {
      logEvent('job_failed', { dbId: id, error: extra?.error_message })
    } else if (status === 'cancelled') {
      logEvent('job_cancelled', { dbId: id })
    }
  }
}

export function getActiveJobs(): JobRow[] {
  return getDb().prepare(
    "SELECT * FROM jobs WHERE status IN ('pending', 'running') ORDER BY created_at ASC"
  ).all() as JobRow[]
}

export function getRecentJobs(limit: number = 20): JobRow[] {
  return getDb().prepare(
    "SELECT * FROM jobs WHERE status IN ('completed', 'failed') ORDER BY completed_at DESC LIMIT ?"
  ).all(limit) as JobRow[]
}

/**
 * Mark any job left 'pending'/'running' from a previous session as 'failed'.
 * The in-memory job queue never survives a restart, so anything still in
 * those states at startup was interrupted by a crash or force-quit — without
 * this, such jobs stayed 'pending'/'running' in the DB and UI forever.
 * Returns the number of rows reconciled, for startup logging.
 */
export function reconcileInterruptedJobs(): number {
  const result = getDb().prepare(`
    UPDATE jobs
    SET status = 'failed',
        error_message = 'Interrupted by app restart',
        completed_at = datetime('now')
    WHERE status IN ('pending', 'running')
  `).run()
  return result.changes
}
