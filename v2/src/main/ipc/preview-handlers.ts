import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { getMpvService } from '../services/mpv-player'
import { getDiscDetectionService } from '../services/disc-detection'
import { findToolPath } from '../util/platform'
import { createLogger } from '../util/logger'

const log = createLogger('preview-handlers')
const discService = getDiscDetectionService()
let stateInterval: ReturnType<typeof setInterval> | null = null

export function registerPreviewHandlers(): void {
  const mpvService = getMpvService()

  ipcMain.handle(IPC.PREVIEW_CHECK, async () => {
    return {
      mpvAvailable: !!findToolPath('mpv'),
      ffplayAvailable: !!findToolPath('ffplay')
    }
  })

  ipcMain.handle(IPC.PREVIEW_START, async (_event, discIndex: number, titleIndex: number) => {
    try {
      const drives = await discService.scanDrives()
      const drive = drives.find((d: { index: number }) => d.index === discIndex)
      const devicePath = drive?.devicePath || (process.platform === 'darwin' ? '/dev/rdisk4' : `/dev/sr${discIndex}`)

      log.info(`Starting preview: disc=${discIndex} title=${titleIndex} device=${devicePath}`)

      const result = await mpvService.start({ dvdDevice: devicePath, titleIndex })

      // Start periodic state updates to renderer
      if (stateInterval) clearInterval(stateInterval)
      const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      if (window && result.player === 'mpv') {
        // Push state updates to renderer every 250ms
        mpvService.onStateUpdate((state) => {
          try {
            window.webContents.send(IPC.PREVIEW_STATE_UPDATE, state)
          } catch {}
        })

        stateInterval = setInterval(() => {
          try {
            const state = mpvService.getPlaybackState()
            window.webContents.send(IPC.PREVIEW_STATE_UPDATE, state)
          } catch {}
        }, 250)
      }

      return { success: true, player: result.player }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Preview start failed: ${msg}`)
      return { success: false, error: msg, player: 'none' }
    }
  })

  ipcMain.handle(IPC.PREVIEW_STOP, async () => {
    if (stateInterval) {
      clearInterval(stateInterval)
      stateInterval = null
    }
    await mpvService.stop()
    return { success: true }
  })

  ipcMain.handle(IPC.PREVIEW_COMMAND, async (_event, command: string, ...args: unknown[]) => {
    try {
      switch (command) {
        case 'togglePause': return await mpvService.togglePause()
        case 'play': return await mpvService.play()
        case 'pause': return await mpvService.pause()
        case 'seek': return await mpvService.seek(args[0] as number)
        case 'seekAbsolute': return await mpvService.seekAbsolute(args[0] as number)
        case 'nextChapter': return await mpvService.nextChapter()
        case 'prevChapter': return await mpvService.prevChapter()
        case 'setAudioTrack': return await mpvService.setAudioTrack(args[0] as number)
        case 'setSubtitleTrack': return await mpvService.setSubtitleTrack(args[0] as number | false)
        case 'setVolume': return await mpvService.setVolume(args[0] as number)
        case 'setTitle': return await mpvService.command(['set_property', 'disc-title', args[0]])
        default:
          log.warn(`Unknown preview command: ${command}`)
          return null
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Preview command "${command}" failed: ${msg}`)
      return { error: msg }
    }
  })

  ipcMain.handle(IPC.PREVIEW_STATE, async () => {
    return mpvService.getPlaybackState()
  })
}
