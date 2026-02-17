import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'

export type ZtrAPI = typeof api

const api = {
  // Disc operations
  disc: {
    scan: () => ipcRenderer.invoke(IPC.DISC_SCAN),
    detect: () => ipcRenderer.invoke(IPC.DISC_DETECT),
    getInfo: (discIndex: number) => ipcRenderer.invoke(IPC.DISC_INFO, discIndex),
    getInfoCached: (discId: string) => ipcRenderer.invoke(IPC.DISC_INFO_CACHED, discId),
    setTmdbCache: (discId: string, tmdbResult: unknown) => ipcRenderer.invoke(IPC.DISC_TMDB_CACHE_SET, discId, tmdbResult),
    eject: (driveIndex: number) => ipcRenderer.invoke(IPC.DISC_EJECT, driveIndex)
  },

  // Preview (mpv/ffplay)
  preview: {
    check: () => ipcRenderer.invoke(IPC.PREVIEW_CHECK),
    start: (discIndex: number, titleIndex: number) => ipcRenderer.invoke(IPC.PREVIEW_START, discIndex, titleIndex),
    stop: () => ipcRenderer.invoke(IPC.PREVIEW_STOP),
    command: (cmd: string, ...args: unknown[]) => ipcRenderer.invoke(IPC.PREVIEW_COMMAND, cmd, ...args),
    getState: () => ipcRenderer.invoke(IPC.PREVIEW_STATE),
    onStateUpdate: (cb: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => cb(state)
      ipcRenderer.on(IPC.PREVIEW_STATE_UPDATE, handler)
      return () => ipcRenderer.removeListener(IPC.PREVIEW_STATE_UPDATE, handler)
    }
  },

  // Rip operations
  rip: {
    start: (params: unknown) => ipcRenderer.invoke(IPC.RIP_START, params),
    cancel: (jobId: string) => ipcRenderer.invoke(IPC.RIP_CANCEL, jobId),
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.RIP_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC.RIP_PROGRESS, handler)
    },
    onComplete: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.RIP_COMPLETE, handler)
      return () => ipcRenderer.removeListener(IPC.RIP_COMPLETE, handler)
    },
    onError: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.RIP_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC.RIP_ERROR, handler)
    }
  },

  // Encode operations
  encode: {
    start: (params: unknown) => ipcRenderer.invoke(IPC.ENCODE_START, params),
    cancel: (jobId: string) => ipcRenderer.invoke(IPC.ENCODE_CANCEL, jobId),
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.ENCODE_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC.ENCODE_PROGRESS, handler)
    },
    onComplete: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.ENCODE_COMPLETE, handler)
      return () => ipcRenderer.removeListener(IPC.ENCODE_COMPLETE, handler)
    },
    onError: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.ENCODE_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC.ENCODE_ERROR, handler)
    }
  },

  // Job operations
  jobs: {
    list: () => ipcRenderer.invoke(IPC.JOB_LIST),
    getStatus: (jobId: string) => ipcRenderer.invoke(IPC.JOB_STATUS, jobId),
    cancel: (jobId: string) => ipcRenderer.invoke(IPC.JOB_CANCEL, jobId)
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_GET, key),
    getAll: () => ipcRenderer.invoke(IPC.SETTINGS_GET_ALL),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC.SETTINGS_SET, key, value),
    getCategory: (category: string) => ipcRenderer.invoke(IPC.SETTINGS_GET_CATEGORY, category)
  },

  // Database
  db: {
    discs: {
      list: () => ipcRenderer.invoke(IPC.DB_DISCS_LIST),
      get: (id: number) => ipcRenderer.invoke(IPC.DB_DISCS_GET, id)
    },
    jobs: {
      list: (filters?: unknown) => ipcRenderer.invoke(IPC.DB_JOBS_LIST, filters),
      get: (id: number) => ipcRenderer.invoke(IPC.DB_JOBS_GET, id)
    },
    outputFiles: {
      list: (jobId?: number) => ipcRenderer.invoke(IPC.DB_OUTPUT_FILES_LIST, jobId)
    },
    discSets: {
      list: () => ipcRenderer.invoke(IPC.DB_DISC_SETS_LIST),
      create: (data: unknown) => ipcRenderer.invoke(IPC.DB_DISC_SETS_CREATE, data)
    }
  },

  // Library
  library: {
    scan: (libraryPath?: string) => ipcRenderer.invoke(IPC.LIBRARY_SCAN, libraryPath),
    scanFolder: (folderPath: string) => ipcRenderer.invoke(IPC.LIBRARY_SCAN_FOLDER, folderPath)
  },

  // Filesystem
  fs: {
    selectDirectory: (title?: string) => ipcRenderer.invoke(IPC.FS_SELECT_DIRECTORY, title),
    selectFile: (title?: string, filters?: Array<{ name: string; extensions: string[] }>) =>
      ipcRenderer.invoke(IPC.FS_SELECT_FILE, title, filters),
    selectFiles: (title?: string, options?: { filters?: Array<{ name: string; extensions: string[] }>; directories?: boolean; multiSelections?: boolean }) =>
      ipcRenderer.invoke(IPC.FS_SELECT_FILES, title, options),
    getDiskSpace: (path: string) => ipcRenderer.invoke(IPC.FS_GET_DISK_SPACE, path),
    openPath: (path: string) => ipcRenderer.invoke(IPC.FS_OPEN_PATH, path)
  },

  // TMDB
  tmdb: {
    search: (query: string, type?: string) => ipcRenderer.invoke(IPC.TMDB_SEARCH, query, type),
    getDetails: (id: number, type: string) => ipcRenderer.invoke(IPC.TMDB_GET_DETAILS, id, type),
    downloadArtwork: (url: string, destPath: string) => ipcRenderer.invoke(IPC.TMDB_DOWNLOAD_ARTWORK, url, destPath)
  },

  // Tools
  tools: {
    check: () => ipcRenderer.invoke(IPC.TOOLS_CHECK),
    test: (toolName: string, toolPath: string) => ipcRenderer.invoke(IPC.TOOLS_TEST, toolName, toolPath),
    detectMakeMKV: () => ipcRenderer.invoke(IPC.TOOLS_DETECT_MAKEMKV)
  },

  // Notifications
  notify: {
    test: () => ipcRenderer.invoke(IPC.NOTIFY_TEST)
  },

  // Audio CD operations
  audio: {
    rip: (params: unknown) => ipcRenderer.invoke(IPC.AUDIO_RIP, params),
    cancel: (jobId: string) => ipcRenderer.invoke(IPC.AUDIO_CANCEL, jobId),
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.AUDIO_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC.AUDIO_PROGRESS, handler)
    },
    onComplete: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.AUDIO_COMPLETE, handler)
      return () => ipcRenderer.removeListener(IPC.AUDIO_COMPLETE, handler)
    },
    onError: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.AUDIO_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC.AUDIO_ERROR, handler)
    }
  },

  // MusicBrainz
  musicbrainz: {
    lookup: (discId: string) => ipcRenderer.invoke(IPC.MUSICBRAINZ_LOOKUP, discId),
    search: (query: string) => ipcRenderer.invoke(IPC.MUSICBRAINZ_SEARCH, query),
    downloadCoverArt: (releaseId: string, destPath: string) =>
      ipcRenderer.invoke(IPC.MUSICBRAINZ_COVER_ART, releaseId, destPath)
  },

  // App info
  app: {
    getVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION),
    getPlatform: () => ipcRenderer.invoke(IPC.APP_GET_PLATFORM)
  },

  // Log forwarding
  log: {
    onEntry: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.LOG_ENTRY, handler)
      return () => ipcRenderer.removeListener(IPC.LOG_ENTRY, handler)
    }
  }
}

contextBridge.exposeInMainWorld('ztr', api)
