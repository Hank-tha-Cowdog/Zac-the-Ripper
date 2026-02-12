import { ipcMain, dialog, shell } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { statfs } from 'fs/promises'

export function registerFsHandlers(): void {
  ipcMain.handle(IPC.FS_SELECT_DIRECTORY, async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title || 'Select Directory',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.FS_GET_DISK_SPACE, async (_event, path: string) => {
    try {
      const stats = await statfs(path)
      return {
        free: stats.bfree * stats.bsize,
        total: stats.blocks * stats.bsize,
        available: stats.bavail * stats.bsize
      }
    } catch {
      return { error: 'Could not read disk space' }
    }
  })

  ipcMain.handle(IPC.FS_OPEN_PATH, async (_event, path: string) => {
    return shell.openPath(path)
  })
}
