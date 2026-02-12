import type { BrowserWindow } from 'electron'

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
type LogLevel = (typeof LOG_LEVELS)[number]

let currentLevel: LogLevel = 'info'
let mainWindow: BrowserWindow | null = null

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(currentLevel)
}

function formatMessage(level: LogLevel, module: string, message: string): string {
  const timestamp = new Date().toISOString()
  return `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}`
}

function broadcastLog(level: LogLevel, module: string, message: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.webContents.send('log:entry', {
      timestamp: new Date().toISOString(),
      level,
      module,
      message
    })
  } catch { /* window may not be ready */ }
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

/** Register the main BrowserWindow so logs get forwarded to the renderer */
export function setLogWindow(window: BrowserWindow): void {
  mainWindow = window
  window.on('closed', () => { mainWindow = null })
}

export function createLogger(module: string) {
  return {
    debug: (message: string, ...args: unknown[]) => {
      if (shouldLog('debug')) console.debug(formatMessage('debug', module, message), ...args)
      if (shouldLog('debug')) broadcastLog('debug', module, message)
    },
    info: (message: string, ...args: unknown[]) => {
      if (shouldLog('info')) console.log(formatMessage('info', module, message), ...args)
      broadcastLog('info', module, message)
    },
    warn: (message: string, ...args: unknown[]) => {
      if (shouldLog('warn')) console.warn(formatMessage('warn', module, message), ...args)
      broadcastLog('warn', module, message)
    },
    error: (message: string, ...args: unknown[]) => {
      if (shouldLog('error')) console.error(formatMessage('error', module, message), ...args)
      broadcastLog('error', module, message)
    }
  }
}
