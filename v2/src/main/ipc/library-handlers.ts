import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { scanLibrary, scanMovieFolder } from '../services/library-scanner'
import { getSetting } from '../database/queries/settings'

export function registerLibraryHandlers(): void {
  ipcMain.handle(IPC.LIBRARY_SCAN, async (_event, libraryPath?: string) => {
    const path = libraryPath || getSetting('kodi.library_path')
    if (!path) return { collections: [], standaloneMovies: [], totalMovies: 0 }
    return scanLibrary(path)
  })

  ipcMain.handle(IPC.LIBRARY_SCAN_FOLDER, async (_event, folderPath: string) => {
    const folderName = folderPath.split('/').pop() || ''
    return scanMovieFolder(folderName, folderPath)
  })
}
