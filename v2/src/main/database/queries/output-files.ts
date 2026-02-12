import { getDb } from '../connection'

export interface OutputFileRow {
  id: number
  job_id: number
  file_path: string
  format: string | null
  video_codec: string | null
  audio_codec: string | null
  resolution: string | null
  bit_depth: number | null
  framerate: string | null
  file_size: number | null
  track_info: string
  kodi_nfo_path: string | null
  created_at: string
}

export function listOutputFiles(jobId?: number): OutputFileRow[] {
  if (jobId) {
    return getDb().prepare('SELECT * FROM output_files WHERE job_id = ? ORDER BY created_at DESC').all(jobId) as OutputFileRow[]
  }
  return getDb().prepare('SELECT * FROM output_files ORDER BY created_at DESC').all() as OutputFileRow[]
}

export function createOutputFile(data: {
  job_id: number
  file_path: string
  format?: string
  video_codec?: string
  audio_codec?: string
  resolution?: string
  bit_depth?: number
  framerate?: string
  file_size?: number
  track_info?: string
  kodi_nfo_path?: string
}): OutputFileRow {
  const result = getDb().prepare(`
    INSERT INTO output_files (job_id, file_path, format, video_codec, audio_codec, resolution, bit_depth, framerate, file_size, track_info, kodi_nfo_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.job_id,
    data.file_path,
    data.format ?? null,
    data.video_codec ?? null,
    data.audio_codec ?? null,
    data.resolution ?? null,
    data.bit_depth ?? null,
    data.framerate ?? null,
    data.file_size ?? null,
    data.track_info ?? '{}',
    data.kodi_nfo_path ?? null
  )

  return getDb().prepare('SELECT * FROM output_files WHERE id = ?').get(Number(result.lastInsertRowid)) as OutputFileRow
}
