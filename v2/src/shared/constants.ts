// Application-wide constants

export const APP_NAME = 'Zac the Ripper'
export const APP_VERSION = '2.0.0'

export const DISC_TYPES = ['DVD', 'BD', 'UHD_BD'] as const
export type DiscType = (typeof DISC_TYPES)[number]

export const JOB_TYPES = ['mkv_rip', 'raw_capture', 'ffv1_encode', 'h264_encode', 'hevc_encode', 'kodi_export', 'jellyfin_export'] as const
export type JobType = (typeof JOB_TYPES)[number]

export const JOB_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const MEDIA_TYPES = ['movie', 'tvshow'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

export const SETTING_CATEGORIES = ['general', 'encoding', 'kodi', 'jellyfin', 'plex', 'notifications', 'paths', 'tools', 'rip'] as const
export type SettingCategory = (typeof SETTING_CATEGORIES)[number]

export const CODEC_OPTIONS = ['hevc', 'h264'] as const
export type CodecOption = (typeof CODEC_OPTIONS)[number]

export const MOVIE_VERSIONS = [
  'Theatrical Cut',
  "Director's Cut",
  'Extended',
  'Widescreen',
  'Fullscreen',
  'Remastered',
  'IMAX',
  '3D',
  'Unrated',
  'Custom'
] as const
export type MovieVersion = (typeof MOVIE_VERSIONS)[number]

export const SOUND_VERSIONS = [
  'DTS',
  'DTS-HD Master Audio',
  'DTS:X',
  'Dolby Digital',
  'Dolby Digital Plus',
  'Dolby TrueHD',
  'Dolby Atmos',
  'Dolby Stereo',
  'Dolby Surround',
  'LPCM',
  'PCM Stereo',
  'Mono',
  'Custom'
] as const
export type SoundVersion = (typeof SOUND_VERSIONS)[number]

export const RIP_MODES = {
  MKV_RIP: 'mkv_rip',
  RAW_CAPTURE: 'raw_capture',
  FFV1_ARCHIVAL: 'ffv1_archival',
  STREAMING_ENCODE: 'streaming_encode',
  KODI_EXPORT: 'kodi_export',
  JELLYFIN_EXPORT: 'jellyfin_export',
  PLEX_EXPORT: 'plex_export'
} as const

export const HW_ACCEL_OPTIONS = ['auto', 'software', 'videotoolbox', 'qsv', 'vaapi', 'nvenc'] as const
export type HWAccelOption = (typeof HW_ACCEL_OPTIONS)[number]

export const DEFAULT_SETTINGS: Record<string, { value: string; category: string }> = {
  // General
  'general.default_output_path': { value: '~/Movies/Zac the Ripper', category: 'general' },
  'general.mode_mkv_rip': { value: 'true', category: 'general' },
  'general.mode_raw_capture': { value: 'false', category: 'general' },
  'general.mode_ffv1_archival': { value: 'false', category: 'general' },
  'general.mode_streaming_encode': { value: 'false', category: 'general' },
  'general.mode_kodi_export': { value: 'false', category: 'general' },
  'general.mode_jellyfin_export': { value: 'true', category: 'general' },
  'general.mode_plex_export': { value: 'false', category: 'general' },

  // Encoding
  'encoding.codec': { value: 'hevc', category: 'encoding' },
  'encoding.hevc_quality': { value: '95', category: 'encoding' },
  'encoding.h264_crf': { value: '18', category: 'encoding' },
  'encoding.h264_preset': { value: 'slow', category: 'encoding' },
  'encoding.h264_maxrate': { value: '15M', category: 'encoding' },
  'encoding.h264_bufsize': { value: '30M', category: 'encoding' },
  'encoding.ffv1_threads': { value: '0', category: 'encoding' },
  'encoding.hw_accel': { value: 'videotoolbox', category: 'encoding' },
  'encoding.preserve_interlaced': { value: 'false', category: 'encoding' },
  'encoding.convert_subs_to_srt': { value: 'false', category: 'encoding' },

  // Kodi
  'kodi.library_path': { value: '', category: 'kodi' },
  'kodi.naming_convention': { value: 'kodi_standard', category: 'kodi' },
  'kodi.tmdb_api_key': { value: '', category: 'kodi' },

  // Jellyfin
  'jellyfin.library_path': { value: '', category: 'jellyfin' },

  // Plex
  'plex.library_path': { value: '', category: 'plex' },

  // Notifications
  'notifications.enabled': { value: 'false', category: 'notifications' },
  'notifications.ntfy_topic': { value: '', category: 'notifications' },
  'notifications.ntfy_server': { value: 'https://ntfy.sh', category: 'notifications' },
  'notifications.on_complete': { value: 'true', category: 'notifications' },
  'notifications.on_failure': { value: 'true', category: 'notifications' },

  // Paths
  'paths.mkv_output': { value: '~/Movies/Zac the Ripper/MKV', category: 'paths' },
  'paths.raw_output': { value: '~/Movies/Zac the Ripper/Raw', category: 'paths' },
  'paths.ffv1_output': { value: '~/Movies/Zac the Ripper/FFV1', category: 'paths' },
  'paths.streaming_output': { value: '~/Movies/Zac the Ripper/Streaming', category: 'paths' },

  // Tools
  'tools.makemkvcon_path': { value: '/usr/local/bin/makemkvcon', category: 'tools' },
  'tools.ffmpeg_path': { value: '/usr/local/bin/ffmpeg', category: 'tools' },
  'tools.ffprobe_path': { value: '/usr/local/bin/ffprobe', category: 'tools' },

  // Rip session (persists across discs)
  'rip.kodi_media_type': { value: 'movie', category: 'rip' },
  'rip.kodi_edition': { value: '', category: 'rip' },
  'rip.kodi_custom_edition': { value: '', category: 'rip' },
  'rip.kodi_extras_disc': { value: 'false', category: 'rip' },
  'rip.sound_version': { value: '', category: 'rip' },
  'rip.custom_sound_version': { value: '', category: 'rip' },
  'rip.disc_number': { value: '', category: 'rip' },
  'rip.total_discs': { value: '', category: 'rip' }
}
