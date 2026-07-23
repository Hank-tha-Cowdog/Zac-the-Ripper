import { homedir } from 'os'
import { join } from 'path'

const PRODUCT_NAME = 'Zac the Ripper'

/**
 * Resolve the platform-appropriate log directory without depending on
 * Electron's `app.getPath('logs')` — deliberately, so this (and anything
 * that imports it) stays loadable from plain Node, including vitest, which
 * doesn't have a real Electron `app` module available.
 */
export function getLogDir(): string {
  const home = homedir()
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Logs', PRODUCT_NAME)
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
    return join(appData, PRODUCT_NAME, 'logs')
  }
  const stateHome = process.env.XDG_STATE_HOME || join(home, '.local', 'state')
  return join(stateHome, 'zac-the-ripper', 'logs')
}
