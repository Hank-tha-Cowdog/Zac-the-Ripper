import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { JobQueueService } from '../services/job-queue'

const jobQueue = JobQueueService.getInstance()

/**
 * Type-agnostic job operations (list/status/cancel by id) used by the
 * renderer's generic `window.ztr.jobs.*` API — as opposed to the per-type
 * `rip.*`/`encode.*`/`audio.*` APIs. Previously unregistered entirely, so
 * every call from the renderer (including the Cancel button in ProgressPage
 * and ActiveJobsPanel) rejected with "No handler registered".
 */
export function registerJobHandlers(): void {
  ipcMain.handle(IPC.JOB_LIST, async () => {
    return jobQueue.getAllJobs()
  })

  ipcMain.handle(IPC.JOB_STATUS, async (_event, jobId: string) => {
    return jobQueue.getJobStatus(jobId) || null
  })

  ipcMain.handle(IPC.JOB_CANCEL, async (_event, jobId: string) => {
    return jobQueue.cancelJob(jobId)
  })
}
