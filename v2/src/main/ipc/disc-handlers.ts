import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IPC } from '../../shared/ipc-channels'
import { getDiscDetectionService } from '../services/disc-detection'
import * as discQueries from '../database/queries/discs'

const execFileAsync = promisify(execFile)

const discService = getDiscDetectionService()

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
          try {
            parsed._tmdbCache = JSON.parse(tmdbCache)
          } catch {
            // Cached TMDB blob is corrupt — ignore, disc metadata is still usable without it
          }
        }
        return parsed
      }
    } catch {
      // Cached disc metadata is corrupt — treat as a cache miss
    }
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

  ipcMain.handle(IPC.DISC_EJECT, async (_event, driveIndex: number) => {
    try {
      // Get the drive's device path from a fresh scan
      const drives = await discService.scanDrives()
      const drive = drives.find(d => d.index === driveIndex)

      if (process.platform === 'darwin') {
        // macOS: bare `drutil eject` targets whatever drive drutil
        // defaults to (verified against the real binary's own help text:
        // "Usage: drutil -drive [drive-arguments] command" — drive
        // targeting is an explicit, separate argument, not inferred). On
        // a single-drive Mac that's harmless, but on a multi-drive rig —
        // exactly the kind of setup this app's batch-mode workflow is
        // for — "eject drive 2" could silently eject drive 1 instead.
        //
        // `-drive <name>` (vendor/product string) looked like the
        // obviously-correct match against this app's DriveInfo.name, but
        // testing it directly against a real drive failed ("Could not
        // find a valid device") — the app's regex-captured vendor string
        // apparently doesn't round-trip into drutil's own name matcher
        // verbatim. `-drive <1-based-index>` was verified to work
        // end-to-end against the real drive on this machine (both
        // `status` and `eject`). This app's own driveIndex is 0-based
        // (MakeMKV's DRV: line numbering), so +1 converts it — verified
        // correct for a single drive; the index *mapping* itself (does
        // drutil's own candidate ordering agree with MakeMKV's?) could
        // not be verified further since this machine only has one drive.
        const args = drive ? ['-drive', String(driveIndex + 1), 'eject'] : ['eject']
        await execFileAsync('drutil', args)
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
