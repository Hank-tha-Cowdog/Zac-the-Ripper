import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IPC } from '../../shared/ipc-channels'
import { DiscDetectionService } from '../services/disc-detection'
import { MakeMKVService } from '../services/makemkv'
import * as discQueries from '../database/queries/discs'

const execFileAsync = promisify(execFile)

const discService = new DiscDetectionService()
const makemkvService = new MakeMKVService()

export function registerDiscHandlers(): void {
  ipcMain.handle(IPC.DISC_SCAN, async () => {
    return discService.scanDrives()
  })

  ipcMain.handle(IPC.DISC_DETECT, async () => {
    return discService.detectDiscs()
  })

  ipcMain.handle(IPC.DISC_INFO, async (_event, discIndex: number) => {
    const info = await discService.getDiscInfo(discIndex)
    // Cache full DiscInfo for future instant recognition
    if (info?.discId) {
      try {
        const existing = discQueries.getDiscByDiscId(info.discId)
        if (existing) {
          discQueries.updateDisc(existing.id, {
            metadata: JSON.stringify(info),
            track_count: info.trackCount
          })
        } else {
          // Create disc record for caching (no rip job yet — needed so TMDB cache has a row to save to)
          discQueries.createDisc({
            title: info.title,
            disc_type: info.discType,
            disc_id: info.discId,
            track_count: info.trackCount,
            metadata: JSON.stringify(info)
          })
        }
      } catch (err) {
        console.warn('[disc-handlers] Failed to cache disc info:', err)
      }
    }
    return info
  })

  ipcMain.handle(IPC.DISC_INFO_CACHED, async (_event, discId: string) => {
    if (!discId) return null
    const { metadata: cached, tmdbCache } = discQueries.getDiscCachedInfo(discId)
    if (!cached) return null
    try {
      const parsed = JSON.parse(cached)
      if (parsed.discId && Array.isArray(parsed.tracks) && parsed.tracks.length > 0) {
        // Attach cached TMDB result if available
        if (tmdbCache) {
          try { parsed._tmdbCache = JSON.parse(tmdbCache) } catch {}
        }
        return parsed
      }
    } catch {}
    return null
  })

  ipcMain.handle(IPC.DISC_TMDB_CACHE_SET, async (_event, discId: string, tmdbResult: unknown) => {
    if (!discId || !tmdbResult) return false
    try {
      discQueries.setDiscTmdbCache(discId, JSON.stringify(tmdbResult))
      return true
    } catch (err) {
      console.warn('[disc-handlers] Failed to save TMDB cache:', err)
      return false
    }
  })

  ipcMain.handle(IPC.DISC_STREAM_START, async (_event, discIndex: number) => {
    try {
      return await makemkvService.startStream(discIndex)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[disc-handlers] Stream start failed:', msg)
      return { port: 0, error: msg }
    }
  })

  ipcMain.handle(IPC.DISC_STREAM_STOP, async () => {
    makemkvService.stopStream()
    return { success: true }
  })

  ipcMain.handle(IPC.DISC_EJECT, async (_event, driveIndex: number) => {
    try {
      // Get the drive's device path from a fresh scan
      const drives = await discService.scanDrives()
      const drive = drives.find(d => d.index === driveIndex)

      if (process.platform === 'darwin') {
        // macOS: drutil eject works for any optical drive
        await execFileAsync('drutil', ['eject'])
        return { success: true }
      } else if (process.platform === 'linux') {
        // Linux: eject command with device path
        const device = drive?.devicePath || `/dev/sr${driveIndex}`
        await execFileAsync('eject', [device])
        return { success: true }
      } else {
        return { success: false, error: 'Eject not supported on this platform' }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[disc-handlers] Eject failed:', msg)
      return { success: false, error: msg }
    }
  })
}
