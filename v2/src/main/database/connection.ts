import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync } from 'fs'
import { DEFAULT_SETTINGS } from '../../shared/constants'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function initDatabase(): void {
  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'data')

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }

  const dbPath = join(dbDir, 'zac-the-ripper.db')
  db = new Database(dbPath)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations()
  seedDefaultSettings()
}

function runMigrations(): void {
  const database = getDb()

  // Create migrations tracking table
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Read and run migration files
  const migrationsDir = join(__dirname, '../main/database/migrations')

  // In development, migrations are in source; in production, bundled
  // Use inline migrations for reliability
  const migrations = getInlineMigrations()

  const applied = new Set(
    database.prepare('SELECT name FROM _migrations').all()
      .map((row: { name: string }) => row.name)
  )

  const insertMigration = database.prepare('INSERT INTO _migrations (name) VALUES (?)')

  // Disable foreign keys during migrations — table recreations (DROP + CREATE)
  // will fail if referencing tables still point to the old table
  database.pragma('foreign_keys = OFF')

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      database.exec(migration.sql)
      insertMigration.run(migration.name)
      console.log(`Applied migration: ${migration.name}`)
    }
  }

  database.pragma('foreign_keys = ON')
}

function getInlineMigrations(): Array<{ name: string; sql: string }> {
  return [
    {
      name: '001_create_disc_sets',
      sql: `
        CREATE TABLE IF NOT EXISTS disc_sets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          set_name TEXT NOT NULL,
          media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tvshow')),
          total_discs INTEGER NOT NULL DEFAULT 1,
          tmdb_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `
    },
    {
      name: '002_create_discs',
      sql: `
        CREATE TABLE IF NOT EXISTS discs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          disc_type TEXT NOT NULL CHECK(disc_type IN ('DVD', 'BD', 'UHD_BD')),
          disc_id TEXT,
          track_count INTEGER DEFAULT 0,
          metadata TEXT DEFAULT '{}',
          disc_set_id INTEGER REFERENCES disc_sets(id),
          disc_number INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_discs_disc_set ON discs(disc_set_id);
      `
    },
    {
      name: '003_create_jobs',
      sql: `
        CREATE TABLE IF NOT EXISTS jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          disc_id INTEGER REFERENCES discs(id),
          job_type TEXT NOT NULL CHECK(job_type IN ('mkv_rip', 'raw_capture', 'ffv1_encode', 'h264_encode', 'kodi_export')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
          progress REAL DEFAULT 0,
          input_path TEXT,
          output_path TEXT,
          encoding_preset TEXT,
          error_message TEXT,
          started_at TEXT,
          completed_at TEXT,
          duration_seconds REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_disc ON jobs(disc_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      `
    },
    {
      name: '004_create_output_files',
      sql: `
        CREATE TABLE IF NOT EXISTS output_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL REFERENCES jobs(id),
          file_path TEXT NOT NULL,
          format TEXT,
          video_codec TEXT,
          audio_codec TEXT,
          resolution TEXT,
          bit_depth INTEGER,
          framerate TEXT,
          file_size INTEGER,
          track_info TEXT DEFAULT '{}',
          kodi_nfo_path TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_output_files_job ON output_files(job_id);
      `
    },
    {
      name: '005_create_settings',
      sql: `
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'general',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
      `
    },
    {
      name: '006_create_kodi_metadata',
      sql: `
        CREATE TABLE IF NOT EXISTS kodi_metadata (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          output_file_id INTEGER NOT NULL REFERENCES output_files(id),
          media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tvshow')),
          title TEXT NOT NULL,
          year INTEGER,
          plot TEXT,
          poster_path TEXT,
          fanart_path TEXT,
          tmdb_id INTEGER,
          imdb_id TEXT,
          genres TEXT DEFAULT '[]',
          runtime INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_kodi_metadata_output_file ON kodi_metadata(output_file_id);
      `
    },
    {
      name: '007_add_hevc_encode_job_type',
      sql: `
        -- SQLite doesn't support ALTER CHECK constraints, so we recreate the jobs table
        -- with the updated CHECK constraint that includes hevc_encode
        DROP TABLE IF EXISTS jobs_new;
        CREATE TABLE jobs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          disc_id INTEGER REFERENCES discs(id),
          job_type TEXT NOT NULL CHECK(job_type IN ('mkv_rip', 'raw_capture', 'ffv1_encode', 'h264_encode', 'hevc_encode', 'kodi_export')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
          progress REAL DEFAULT 0,
          input_path TEXT,
          output_path TEXT,
          encoding_preset TEXT,
          error_message TEXT,
          started_at TEXT,
          completed_at TEXT,
          duration_seconds REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO jobs_new SELECT * FROM jobs;
        DROP TABLE jobs;
        ALTER TABLE jobs_new RENAME TO jobs;
        CREATE INDEX IF NOT EXISTS idx_jobs_disc ON jobs(disc_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      `
    },
    {
      name: '008_seed_new_encoding_settings',
      sql: `
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('encoding.codec', 'h264', 'encoding');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('encoding.hevc_quality', '95', 'encoding');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('paths.streaming_output', '~/Movies/Zac the Ripper/Streaming', 'paths');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('general.mode_streaming_encode', 'false', 'general');
      `
    },
    {
      name: '009_migrate_h264_streaming_to_streaming_encode',
      sql: `
        -- Copy h264_streaming setting value to streaming_encode for existing users
        UPDATE settings SET value = (
          SELECT value FROM settings WHERE key = 'general.mode_h264_streaming'
        ) WHERE key = 'general.mode_streaming_encode'
          AND EXISTS (SELECT 1 FROM settings WHERE key = 'general.mode_h264_streaming');
        -- Update hw_accel default to videotoolbox for existing users still on software
        UPDATE settings SET value = 'videotoolbox'
          WHERE key = 'encoding.hw_accel' AND value = 'software';
      `
    },
    {
      name: '010_seed_rip_session_settings',
      sql: `
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('rip.kodi_media_type', 'movie', 'rip');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('rip.kodi_edition', '', 'rip');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('rip.kodi_custom_edition', '', 'rip');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('rip.kodi_extras_disc', 'false', 'rip');
      `
    },
    {
      name: '011_index_discs_disc_id',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_discs_disc_id ON discs(disc_id);
      `
    },
    {
      name: '012_add_tmdb_cache',
      sql: `
        ALTER TABLE discs ADD COLUMN tmdb_cache TEXT DEFAULT NULL;
      `
    },
    {
      name: '013_lower_hevc_quality_default',
      sql: `
        UPDATE settings SET value = '65' WHERE key = 'encoding.hevc_quality' AND value = '95';
      `
    },
    {
      name: '014_add_jellyfin_export_job_type',
      sql: `
        DROP TABLE IF EXISTS jobs_new;
        CREATE TABLE jobs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          disc_id INTEGER REFERENCES discs(id),
          job_type TEXT NOT NULL CHECK(job_type IN ('mkv_rip', 'raw_capture', 'ffv1_encode', 'h264_encode', 'hevc_encode', 'kodi_export', 'jellyfin_export')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
          progress REAL DEFAULT 0,
          input_path TEXT,
          output_path TEXT,
          encoding_preset TEXT,
          error_message TEXT,
          started_at TEXT,
          completed_at TEXT,
          duration_seconds REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO jobs_new SELECT * FROM jobs;
        DROP TABLE jobs;
        ALTER TABLE jobs_new RENAME TO jobs;
        CREATE INDEX IF NOT EXISTS idx_jobs_disc ON jobs(disc_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('general.mode_jellyfin_export', 'true', 'general');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('jellyfin.library_path', '', 'jellyfin');
      `
    },
    {
      name: '015_seed_plex_settings',
      sql: `
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('general.mode_plex_export', 'false', 'plex');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('plex.library_path', '', 'plex');
      `
    },
    {
      name: '016_seed_notification_settings',
      sql: `
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('notifications.enabled', 'false', 'notifications');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('notifications.ntfy_topic', '', 'notifications');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('notifications.ntfy_server', 'https://ntfy.sh', 'notifications');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('notifications.on_complete', 'true', 'notifications');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('notifications.on_failure', 'true', 'notifications');
      `
    }
    ,
    {
      name: '017_seed_sound_version_disc_number_settings',
      sql: `
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('rip.sound_version', '', 'rip');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('rip.custom_sound_version', '', 'rip');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('rip.disc_number', '', 'rip');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('rip.total_discs', '', 'rip');
      `
    },
    {
      name: '018_add_plex_export_and_movie_title',
      sql: `
        DROP TABLE IF EXISTS jobs_new;
        CREATE TABLE jobs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          disc_id INTEGER REFERENCES discs(id),
          job_type TEXT NOT NULL CHECK(job_type IN ('mkv_rip', 'raw_capture', 'ffv1_encode', 'h264_encode', 'hevc_encode', 'kodi_export', 'jellyfin_export', 'plex_export')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
          progress REAL DEFAULT 0,
          input_path TEXT,
          output_path TEXT,
          encoding_preset TEXT,
          error_message TEXT,
          movie_title TEXT,
          started_at TEXT,
          completed_at TEXT,
          duration_seconds REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO jobs_new (id, disc_id, job_type, status, progress, input_path, output_path, encoding_preset, error_message, movie_title, started_at, completed_at, duration_seconds, created_at, updated_at)
          SELECT id, disc_id, job_type, status, progress, input_path, output_path, encoding_preset, error_message, NULL, started_at, completed_at, duration_seconds, created_at, updated_at FROM jobs;
        DROP TABLE jobs;
        ALTER TABLE jobs_new RENAME TO jobs;
        CREATE INDEX IF NOT EXISTS idx_jobs_disc ON jobs(disc_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      `
    },
    {
      name: '019_default_codec_h264',
      sql: `
        UPDATE settings SET value = 'h264' WHERE key = 'encoding.codec' AND value = 'hevc';
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('encoding.h264_vt_quality', '65', 'encoding');
      `
    },
    {
      name: '020_add_audio_cd_support',
      sql: `
        -- Recreate discs table with AUDIO_CD disc type
        DROP TABLE IF EXISTS discs_new;
        CREATE TABLE discs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          disc_type TEXT NOT NULL CHECK(disc_type IN ('DVD', 'BD', 'UHD_BD', 'AUDIO_CD')),
          disc_id TEXT,
          track_count INTEGER DEFAULT 0,
          metadata TEXT DEFAULT '{}',
          disc_set_id INTEGER REFERENCES disc_sets(id),
          disc_number INTEGER,
          tmdb_cache TEXT DEFAULT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO discs_new (id, title, disc_type, disc_id, track_count, metadata, disc_set_id, disc_number, tmdb_cache, created_at, updated_at)
          SELECT id, title, disc_type, disc_id, track_count, metadata, disc_set_id, disc_number, tmdb_cache, created_at, updated_at FROM discs;
        DROP TABLE discs;
        ALTER TABLE discs_new RENAME TO discs;
        CREATE INDEX IF NOT EXISTS idx_discs_disc_set ON discs(disc_set_id);
        CREATE INDEX IF NOT EXISTS idx_discs_disc_id ON discs(disc_id);

        -- Recreate jobs table with music_export job type
        DROP TABLE IF EXISTS jobs_new;
        CREATE TABLE jobs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          disc_id INTEGER REFERENCES discs(id),
          job_type TEXT NOT NULL CHECK(job_type IN ('mkv_rip', 'raw_capture', 'ffv1_encode', 'h264_encode', 'hevc_encode', 'kodi_export', 'jellyfin_export', 'plex_export', 'music_export')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
          progress REAL DEFAULT 0,
          input_path TEXT,
          output_path TEXT,
          encoding_preset TEXT,
          error_message TEXT,
          movie_title TEXT,
          started_at TEXT,
          completed_at TEXT,
          duration_seconds REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO jobs_new (id, disc_id, job_type, status, progress, input_path, output_path, encoding_preset, error_message, movie_title, started_at, completed_at, duration_seconds, created_at, updated_at)
          SELECT id, disc_id, job_type, status, progress, input_path, output_path, encoding_preset, error_message, movie_title, started_at, completed_at, duration_seconds, created_at, updated_at FROM jobs;
        DROP TABLE jobs;
        ALTER TABLE jobs_new RENAME TO jobs;
        CREATE INDEX IF NOT EXISTS idx_jobs_disc ON jobs(disc_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

        -- Seed audio settings
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('audio.format', 'flac', 'audio');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('audio.flac_compression', '8', 'audio');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('audio.embed_cover_art', 'true', 'audio');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('audio.musicbrainz_auto_lookup', 'true', 'audio');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('paths.music_output', '~/Music/Zac the Ripper', 'paths');
        INSERT OR IGNORE INTO settings (key, value, category) VALUES ('tools.cdparanoia_path', '', 'tools');
      `
    }
  ]
}

function seedDefaultSettings(): void {
  const database = getDb()
  const insert = database.prepare(`
    INSERT OR IGNORE INTO settings (key, value, category) VALUES (?, ?, ?)
  `)

  const insertMany = database.transaction(() => {
    for (const [key, { value, category }] of Object.entries(DEFAULT_SETTINGS)) {
      insert.run(key, value, category)
    }
  })

  insertMany()
}
