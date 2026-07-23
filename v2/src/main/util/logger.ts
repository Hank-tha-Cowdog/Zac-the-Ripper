import type { BrowserWindow } from 'electron'
import { getLogDir } from './log-paths'
import { RotatingFile } from './rotating-file'
import { safeSend } from './safe-send'

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
type LogLevel = (typeof LOG_LEVELS)[number]

// ZTR_LOG_LEVEL lets a supervising session (or a developer) turn on debug
// output — including raw MakeMKV/ffmpeg/cdparanoia stderr — without a code
// change or UI setting. Defaults to 'info'.
const envLevel = process.env.ZTR_LOG_LEVEL as LogLevel | undefined
let currentLevel: LogLevel = envLevel && LOG_LEVELS.includes(envLevel) ? envLevel : 'info'

let mainWindow: BrowserWindow | null = null

// Lazy so importing logger.ts (transitively, by nearly every module in the
// app) never touches the filesystem — only the first actual log call does.
let fileSink: RotatingFile | null = null
let logDirOverride: string | null = null

function getFileSink(): RotatingFile {
  if (!fileSink) fileSink = new RotatingFile(logDirOverride ?? getLogDir(), 'main.log')
  return fileSink
}

/**
 * Test-only escape hatch: redirect the file sink to a temp directory instead
 * of the real ~/Library/Logs/... path, and reset the cached sink so it picks
 * up the change immediately. Pass null to restore default behavior.
 */
export function _setLogDirForTesting(dir: string | null): void {
  logDirOverride = dir
  fileSink = null
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(currentLevel)
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return ''
  return ' ' + args.map(a => {
    if (a instanceof Error) return a.stack || a.message
    if (typeof a === 'string') return a
    try {
      return JSON.stringify(a)
    } catch {
      return String(a)
    }
  }).join(' ')
}

function formatMessage(level: LogLevel, module: string, message: string, args: unknown[]): string {
  const timestamp = new Date().toISOString()
  return `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}${formatArgs(args)}`
}

function broadcastLog(level: LogLevel, module: string, message: string, args: unknown[]): void {
  // Previously checked only mainWindow.isDestroyed() — during app teardown
  // a window can be in a state where that returns false but its webContents
  // frame is already gone, and Electron reports the resulting send failure
  // straight to stderr ("Render frame was disposed before WebFrameMain
  // could be accessed") independent of any try/catch around the call.
  // safeSend's extra webContents.isDestroyed() check catches that window.
  safeSend(mainWindow, 'log:entry', {
    timestamp: new Date().toISOString(),
    level,
    module,
    message: message + formatArgs(args)
  })
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

/** Register the main BrowserWindow so logs get forwarded to the renderer */
export function setLogWindow(window: BrowserWindow): void {
  mainWindow = window
  window.on('closed', () => { mainWindow = null })
}

function log(level: LogLevel, module: string, message: string, args: unknown[]): void {
  if (!shouldLog(level)) return
  const line = formatMessage(level, module, message, args)

  const consoleFn = level === 'debug' ? console.debug
    : level === 'info' ? console.log
    : level === 'warn' ? console.warn
    : console.error
  consoleFn(line)

  getFileSink().append(line)
  broadcastLog(level, module, message, args)
}

export function createLogger(module: string) {
  return {
    debug: (message: string, ...args: unknown[]) => log('debug', module, message, args),
    info: (message: string, ...args: unknown[]) => log('info', module, message, args),
    warn: (message: string, ...args: unknown[]) => log('warn', module, message, args),
    error: (message: string, ...args: unknown[]) => log('error', module, message, args)
  }
}
