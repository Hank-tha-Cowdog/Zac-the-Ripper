import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import * as discQueries from '../database/queries/discs'
import * as jobQueries from '../database/queries/jobs'
import * as outputFileQueries from '../database/queries/output-files'
import * as discSetQueries from '../database/queries/disc-sets'

export function registerDbHandlers(): void {
  // Discs
  ipcMain.handle(IPC.DB_DISCS_LIST, async () => {
    return discQueries.listDiscs()
  })

  ipcMain.handle(IPC.DB_DISCS_GET, async (_event, id: number) => {
    return discQueries.getDisc(id)
  })

  // Jobs
  ipcMain.handle(IPC.DB_JOBS_LIST, async (_event, filters?: { discId?: number; status?: string }) => {
    return jobQueries.listJobs(filters)
  })

  ipcMain.handle(IPC.DB_JOBS_GET, async (_event, id: number) => {
    return jobQueries.getJob(id)
  })

  ipcMain.handle(IPC.DB_JOBS_RECENT, async (_event, limit?: number) => {
    return jobQueries.getRecentJobs(limit || 20)
  })

  // Output files
  ipcMain.handle(IPC.DB_OUTPUT_FILES_LIST, async (_event, jobId?: number) => {
    return outputFileQueries.listOutputFiles(jobId)
  })

  // Disc sets
  ipcMain.handle(IPC.DB_DISC_SETS_LIST, async () => {
    return discSetQueries.listDiscSets()
  })

  ipcMain.handle(IPC.DB_DISC_SETS_CREATE, async (_event, data: {
    set_name: string
    media_type: string
    total_discs: number
    tmdb_id?: number
  }) => {
    return discSetQueries.createDiscSet(data)
  })
}
