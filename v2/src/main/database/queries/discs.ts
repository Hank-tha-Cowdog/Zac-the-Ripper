import { getDb } from '../connection'

export interface DiscRow {
  id: number
  title: string
  disc_type: string
  disc_id: string | null
  track_count: number
  metadata: string
  disc_set_id: number | null
  disc_number: number | null
  created_at: string
  updated_at: string
}

export function listDiscs(): DiscRow[] {
  return getDb().prepare(`
    SELECT * FROM discs ORDER BY created_at DESC
  `).all() as DiscRow[]
}

export function getDisc(id: number): DiscRow | undefined {
  return getDb().prepare('SELECT * FROM discs WHERE id = ?').get(id) as DiscRow | undefined
}

export function createDisc(data: {
  title: string
  disc_type: string
  disc_id?: string
  track_count?: number
  metadata?: string
  disc_set_id?: number
  disc_number?: number
}): DiscRow {
  const result = getDb().prepare(`
    INSERT INTO discs (title, disc_type, disc_id, track_count, metadata, disc_set_id, disc_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.title,
    data.disc_type,
    data.disc_id ?? null,
    data.track_count ?? 0,
    data.metadata ?? '{}',
    data.disc_set_id ?? null,
    data.disc_number ?? null
  )

  return getDisc(Number(result.lastInsertRowid))!
}

export function getDiscByDiscId(discId: string): DiscRow | undefined {
  return getDb().prepare(
    'SELECT * FROM discs WHERE disc_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(discId) as DiscRow | undefined
}

export function getDiscCachedInfo(discId: string): { metadata: string | null; tmdbCache: string | null } {
  // Get most recent disc metadata
  const metaRow = getDb().prepare(
    `SELECT metadata FROM discs WHERE disc_id = ? AND metadata != '{}' ORDER BY updated_at DESC LIMIT 1`
  ).get(discId) as { metadata: string } | undefined

  // Search for TMDB cache across ALL records for this disc_id
  // (createRipJob creates new records that may not have the TMDB cache)
  const tmdbRow = getDb().prepare(
    `SELECT tmdb_cache FROM discs WHERE disc_id = ? AND tmdb_cache IS NOT NULL ORDER BY updated_at DESC LIMIT 1`
  ).get(discId) as { tmdb_cache: string } | undefined

  return { metadata: metaRow?.metadata ?? null, tmdbCache: tmdbRow?.tmdb_cache ?? null }
}

export function setDiscTmdbCache(discId: string, tmdbCache: string): void {
  const row = getDiscByDiscId(discId)
  if (row) {
    getDb().prepare(
      `UPDATE discs SET tmdb_cache = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(tmdbCache, row.id)
  }
}

export function updateDisc(id: number, data: Partial<{
  title: string
  track_count: number
  metadata: string
  tmdb_cache: string | null
  disc_set_id: number | null
  disc_number: number | null
}>): void {
  const fields: string[] = []
  const values: unknown[] = []

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`)
      values.push(value)
    }
  }

  if (fields.length === 0) return

  fields.push("updated_at = datetime('now')")
  values.push(id)

  getDb().prepare(`UPDATE discs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}
