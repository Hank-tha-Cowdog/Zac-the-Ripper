import { registerDiscHandlers } from './disc-handlers'
import { registerRipHandlers } from './rip-handlers'
import { registerEncodeHandlers } from './encode-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerFsHandlers } from './fs-handlers'
import { registerDbHandlers } from './db-handlers'
import { registerTmdbHandlers } from './tmdb-handlers'
import { registerToolsHandlers } from './tools-handlers'
import { registerAppHandlers } from './app-handlers'
import { registerLibraryHandlers } from './library-handlers'

export function registerAllIpcHandlers(): void {
  registerDiscHandlers()
  registerRipHandlers()
  registerEncodeHandlers()
  registerSettingsHandlers()
  registerFsHandlers()
  registerDbHandlers()
  registerTmdbHandlers()
  registerToolsHandlers()
  registerAppHandlers()
  registerLibraryHandlers()
}
