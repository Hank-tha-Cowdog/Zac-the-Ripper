// IPC Channel constants shared between main and renderer processes

export const IPC = {
  // Disc operations
  DISC_SCAN: 'disc:scan',
  DISC_DETECT: 'disc:detect',
  DISC_INFO: 'disc:info',
  DISC_INFO_CACHED: 'disc:info-cached',
  DISC_TMDB_CACHE_SET: 'disc:tmdb-cache-set',
  DISC_EJECT: 'disc:eject',
  DISC_STREAM_START: 'disc:stream-start',
  DISC_STREAM_STOP: 'disc:stream-stop',

  // Rip operations
  RIP_START: 'rip:start',
  RIP_CANCEL: 'rip:cancel',
  RIP_PROGRESS: 'rip:progress',
  RIP_COMPLETE: 'rip:complete',
  RIP_ERROR: 'rip:error',

  // Encode operations
  ENCODE_START: 'encode:start',
  ENCODE_CANCEL: 'encode:cancel',
  ENCODE_PROGRESS: 'encode:progress',
  ENCODE_COMPLETE: 'encode:complete',
  ENCODE_ERROR: 'encode:error',

  // Job queue
  JOB_LIST: 'job:list',
  JOB_STATUS: 'job:status',
  JOB_CANCEL: 'job:cancel',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_CATEGORY: 'settings:get-category',

  // Database
  DB_QUERY: 'db:query',
  DB_DISCS_LIST: 'db:discs:list',
  DB_DISCS_GET: 'db:discs:get',
  DB_JOBS_LIST: 'db:jobs:list',
  DB_JOBS_GET: 'db:jobs:get',
  DB_OUTPUT_FILES_LIST: 'db:output-files:list',
  DB_DISC_SETS_LIST: 'db:disc-sets:list',
  DB_DISC_SETS_CREATE: 'db:disc-sets:create',

  // Filesystem
  FS_SELECT_DIRECTORY: 'fs:select-directory',
  FS_GET_DISK_SPACE: 'fs:get-disk-space',
  FS_OPEN_PATH: 'fs:open-path',

  // TMDB
  TMDB_SEARCH: 'tmdb:search',
  TMDB_GET_DETAILS: 'tmdb:get-details',
  TMDB_DOWNLOAD_ARTWORK: 'tmdb:download-artwork',

  // Library
  LIBRARY_SCAN: 'library:scan',
  LIBRARY_SCAN_FOLDER: 'library:scan-folder',

  // Tools
  TOOLS_CHECK: 'tools:check',
  TOOLS_TEST: 'tools:test',
  TOOLS_DETECT_MAKEMKV: 'tools:detect-makemkv',

  // App
  APP_GET_VERSION: 'app:get-version',
  APP_GET_PLATFORM: 'app:get-platform',

  // Notifications
  NOTIFY_TEST: 'notify:test',

  // Log forwarding (main → renderer)
  LOG_ENTRY: 'log:entry'
} as const
