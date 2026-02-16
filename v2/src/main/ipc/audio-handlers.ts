import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { MusicBrainzService } from '../services/musicbrainz'
import { JobQueueService } from '../services/job-queue'

const musicBrainzService = new MusicBrainzService()
const jobQueue = JobQueueService.getInstance()

export function registerAudioHandlers(): void {
  // MusicBrainz handlers
  ipcMain.handle(IPC.MUSICBRAINZ_LOOKUP, async (_event, discId: string) => {
    return musicBrainzService.lookupByDiscId(discId)
  })

  ipcMain.handle(IPC.MUSICBRAINZ_SEARCH, async (_event, query: string) => {
    return musicBrainzService.search(query)
  })

  ipcMain.handle(IPC.MUSICBRAINZ_COVER_ART, async (_event, releaseId: string, destPath: string) => {
    return musicBrainzService.downloadCoverArt(releaseId, destPath)
  })

  // Audio rip handlers
  ipcMain.handle(IPC.AUDIO_RIP, async (event, params: {
    trackNumbers: number[]
    artist: string
    albumArtist: string
    album: string
    year: string
    discNumber: number
    totalDiscs: number
    tracks: Array<{ number: number; title: string; artist: string }>
    mbReleaseId: string | null
    isVariousArtists: boolean
    coverArtPath: string | null
    devicePath?: string
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { error: 'No window found' }

    return jobQueue.createMusicRipJob({
      ...params,
      window
    })
  })

  ipcMain.handle(IPC.AUDIO_CANCEL, async (_event, jobId: string) => {
    return jobQueue.cancelJob(jobId)
  })
}
