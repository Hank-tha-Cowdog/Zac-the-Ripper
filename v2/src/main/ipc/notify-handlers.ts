import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { sendNotification } from '../services/notify'

export function registerNotifyHandlers(): void {
  ipcMain.handle(IPC.NOTIFY_TEST, async () => {
    const success = await sendNotification({
      title: 'Zac the Ripper',
      message: 'Test notification — your ntfy setup is working!',
      priority: 3,
      tags: ['white_check_mark', 'movie_camera']
    })
    return { success }
  })
}
