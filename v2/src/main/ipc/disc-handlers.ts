import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { DiscDetectionService } from '../services/disc-detection'
import * as discQueries from '../database/queries/discs'

const discService = new DiscDetectionService()

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
}
