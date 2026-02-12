import { getDb } from '../connection'

export interface DiscSetRow {
  id: number
  set_name: string
  media_type: string
  total_discs: number
  tmdb_id: number | null
  created_at: string
  updated_at: string
}

export function listDiscSets(): DiscSetRow[] {
  return getDb().prepare('SELECT * FROM disc_sets ORDER BY created_at DESC').all() as DiscSetRow[]
}

export function getDiscSet(id: number): DiscSetRow | undefined {
  return getDb().prepare('SELECT * FROM disc_sets WHERE id = ?').get(id) as DiscSetRow | undefined
}

export function createDiscSet(data: {
  set_name: string
  media_type: string
  total_discs: number
  tmdb_id?: number
}): DiscSetRow {
  const result = getDb().prepare(`
    INSERT INTO disc_sets (set_name, media_type, total_discs, tmdb_id)
    VALUES (?, ?, ?, ?)
  `).run(data.set_name, data.media_type, data.total_discs, data.tmdb_id ?? null)

  return getDiscSet(Number(result.lastInsertRowid))!
}

export function getDiscSetWithProgress(id: number): DiscSetRow & { ripped_discs: number } {
  const set = getDiscSet(id)
  if (!set) throw new Error(`Disc set ${id} not found`)

  const count = getDb().prepare(
    'SELECT COUNT(*) as count FROM discs WHERE disc_set_id = ?'
  ).get(id) as { count: number }

  return { ...set, ripped_discs: count.count }
}

export function listDiscSetsWithProgress(): Array<DiscSetRow & { ripped_discs: number }> {
  return getDb().prepare(`
    SELECT ds.*, COALESCE(dc.count, 0) as ripped_discs
    FROM disc_sets ds
    LEFT JOIN (SELECT disc_set_id, COUNT(*) as count FROM discs GROUP BY disc_set_id) dc ON dc.disc_set_id = ds.id
    ORDER BY ds.created_at DESC
  `).all() as Array<DiscSetRow & { ripped_discs: number }>
}
