import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { JobQueueService } from '../services/job-queue'

const jobQueue = JobQueueService.getInstance()

export function registerEncodeHandlers(): void {
  ipcMain.handle(IPC.ENCODE_START, async (event, params: {
    inputPath: string
    outputDir: string
    preset: string
    preserveInterlaced: boolean
    convertSubsToSrt: boolean
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { error: 'No window found' }

    return jobQueue.createEncodeJob({
      ...params,
      window
    })
  })

  ipcMain.handle(IPC.ENCODE_CANCEL, async (_event, jobId: string) => {
    return jobQueue.cancelJob(jobId)
  })
}
