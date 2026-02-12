import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { getSetting, getAllSettings, setSetting, getSettingsByCategory } from '../database/queries/settings'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, async (_event, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle(IPC.SETTINGS_GET_ALL, async () => {
    return getAllSettings()
  })

  ipcMain.handle(IPC.SETTINGS_SET, async (_event, key: string, value: string) => {
    return setSetting(key, value)
  })

  ipcMain.handle(IPC.SETTINGS_GET_CATEGORY, async (_event, category: string) => {
    return getSettingsByCategory(category)
  })
}
