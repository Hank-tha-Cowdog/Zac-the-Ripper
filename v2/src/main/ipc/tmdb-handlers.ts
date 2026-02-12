import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { TMDBService } from '../services/tmdb'

const tmdbService = new TMDBService()

export function registerTmdbHandlers(): void {
  ipcMain.handle(IPC.TMDB_SEARCH, async (_event, query: string, type?: string) => {
    return tmdbService.search(query, type)
  })

  ipcMain.handle(IPC.TMDB_GET_DETAILS, async (_event, id: number, type: string) => {
    return tmdbService.getDetails(id, type)
  })

  ipcMain.handle(IPC.TMDB_DOWNLOAD_ARTWORK, async (_event, url: string, destPath: string) => {
    return tmdbService.downloadArtwork(url, destPath)
  })
}
