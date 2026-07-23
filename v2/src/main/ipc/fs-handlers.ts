import { ipcMain, dialog, shell } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { statfs } from 'fs/promises'
import { existsSync } from 'fs'

export function registerFsHandlers(): void {
  ipcMain.handle(IPC.FS_SELECT_DIRECTORY, async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title || 'Select Directory',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.FS_SELECT_FILE, async (_event, title?: string, filters?: Array<{ name: string; extensions: string[] }>) => {
    const result = await dialog.showOpenDialog({
      title: title || 'Select File',
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.FS_SELECT_FILES, async (_event, title?: string, options?: { filters?: Array<{ name: string; extensions: string[] }>; directories?: boolean; multiSelections?: boolean }) => {
    const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> = []
    if (options?.directories) {
      properties.push('openDirectory')
    } else {
      properties.push('openFile')
    }
    if (options?.multiSelections !== false) {
      properties.push('multiSelections')
    }

    const result = await dialog.showOpenDialog({
      title: title || 'Select Files',
      properties,
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }]
    })
    if (result.canceled) return []
    return result.filePaths
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
    // Currently only called with app-generated output_files.file_path
    // values, but this is the IPC boundary — validate here regardless of
    // what today's one caller happens to pass, rather than handing
    // whatever string the renderer sends straight to a native OS call.
    if (!path || typeof path !== 'string' || !existsSync(path)) {
      return 'Path does not exist'
    }
    return shell.openPath(path)
  })
}
