import { ipcMain, app } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { APP_VERSION } from '../../shared/constants'

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.APP_GET_VERSION, () => {
    return APP_VERSION
  })

  ipcMain.handle(IPC.APP_GET_PLATFORM, () => {
    return {
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      appPath: app.getPath('userData')
    }
  })
}
