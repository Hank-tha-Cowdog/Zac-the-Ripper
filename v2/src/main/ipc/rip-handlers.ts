import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { MakeMKVService } from '../services/makemkv'
import { JobQueueService } from '../services/job-queue'

const makemkvService = new MakeMKVService()
const jobQueue = JobQueueService.getInstance()

export function registerRipHandlers(): void {
  ipcMain.handle(IPC.RIP_START, async (event, params: {
    discIndex: number
    titleIds: number[]
    outputDir: string
    modes: string[]
    preserveInterlaced: boolean
    convertSubsToSrt: boolean
    kodiOptions?: unknown
    discSetId?: number
    discNumber?: number
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { error: 'No window found' }

    return jobQueue.createRipJob({
      ...params,
      window,
      makemkvService
    })
  })

  ipcMain.handle(IPC.RIP_CANCEL, async (_event, jobId: string) => {
    return jobQueue.cancelJob(jobId)
  })
}
