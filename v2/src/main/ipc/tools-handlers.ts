import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { checkTools, testTool } from '../util/tool-checker'
import { findToolPath } from '../util/platform'
import { setSetting } from '../database/queries/settings'

export function registerToolsHandlers(): void {
  ipcMain.handle(IPC.TOOLS_CHECK, async () => {
    return checkTools()
  })

  ipcMain.handle(IPC.TOOLS_TEST, async (_event, toolName: string, toolPath: string) => {
    return testTool(toolName, toolPath)
  })

  ipcMain.handle(IPC.TOOLS_DETECT_MAKEMKV, async () => {
    const path = findToolPath('makemkvcon')
    if (path) {
      setSetting('tools.makemkvcon_path', path)
      const result = await testTool('makemkvcon', path)
      return { found: result.available, path, version: result.version }
    }
    return { found: false, path: null, version: null }
  })
}
