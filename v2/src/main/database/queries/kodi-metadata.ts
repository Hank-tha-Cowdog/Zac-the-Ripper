import { getDb } from '../connection'

export interface KodiMetadataRow {
  id: number
  output_file_id: number
  media_type: string
  title: string
  year: number | null
  plot: string | null
  poster_path: string | null
  fanart_path: string | null
  tmdb_id: number | null
  imdb_id: string | null
  genres: string
  runtime: number | null
  created_at: string
  updated_at: string
}

export function getKodiMetadata(outputFileId: number): KodiMetadataRow | undefined {
  return getDb().prepare(
    'SELECT * FROM kodi_metadata WHERE output_file_id = ?'
  ).get(outputFileId) as KodiMetadataRow | undefined
}

export function createKodiMetadata(data: {
  output_file_id: number
  media_type: string
  title: string
  year?: number
  plot?: string
  poster_path?: string
  fanart_path?: string
  tmdb_id?: number
  imdb_id?: string
  genres?: string
  runtime?: number
}): KodiMetadataRow {
  const result = getDb().prepare(`
    INSERT INTO kodi_metadata (output_file_id, media_type, title, year, plot, poster_path, fanart_path, tmdb_id, imdb_id, genres, runtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.output_file_id,
    data.media_type,
    data.title,
    data.year ?? null,
    data.plot ?? null,
    data.poster_path ?? null,
    data.fanart_path ?? null,
    data.tmdb_id ?? null,
    data.imdb_id ?? null,
    data.genres ?? '[]',
    data.runtime ?? null
  )

  return getDb().prepare('SELECT * FROM kodi_metadata WHERE id = ?').get(Number(result.lastInsertRowid)) as KodiMetadataRow
}
