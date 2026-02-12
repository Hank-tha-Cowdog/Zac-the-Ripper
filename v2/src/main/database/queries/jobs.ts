import { getDb } from '../connection'

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
  started_at: string | null
  completed_at: string | null
  duration_seconds: number | null
  created_at: string
  updated_at: string
}

export function listJobs(filters?: { discId?: number; status?: string }): (JobRow & { disc_title?: string })[] {
  let sql = 'SELECT jobs.*, discs.title AS disc_title FROM jobs LEFT JOIN discs ON jobs.disc_id = discs.id'
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

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ')
  }

  sql += ' ORDER BY jobs.created_at DESC'

  return getDb().prepare(sql).all(...params) as (JobRow & { disc_title?: string })[]
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
}): JobRow {
  const result = getDb().prepare(`
    INSERT INTO jobs (disc_id, job_type, status, input_path, output_path, encoding_preset)
    VALUES (?, ?, 'pending', ?, ?, ?)
  `).run(
    data.disc_id ?? null,
    data.job_type,
    data.input_path ?? null,
    data.output_path ?? null,
    data.encoding_preset ?? null
  )

  return getJob(Number(result.lastInsertRowid))!
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

  values.push(id)
  getDb().prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function getActiveJobs(): JobRow[] {
  return getDb().prepare(
    "SELECT * FROM jobs WHERE status IN ('pending', 'running') ORDER BY created_at ASC"
  ).all() as JobRow[]
}

export function getRecentJobs(limit: number = 10): JobRow[] {
  return getDb().prepare(
    'SELECT * FROM jobs WHERE status = ? ORDER BY completed_at DESC LIMIT ?'
  ).all('completed', limit) as JobRow[]
}
