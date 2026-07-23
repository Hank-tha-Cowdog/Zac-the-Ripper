import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { initDatabase } from './database/connection'
import { reconcileInterruptedJobs } from './database/queries/jobs'
import { registerAllIpcHandlers } from './ipc'
import { setLogWindow, createLogger } from './util/logger'
import { sweepStaleTempFiles } from './util/temp-sweep'
import { logEvent } from './util/event-log'
import { writeStatusSnapshot, recordLastError } from './util/status-snapshot'
import { isAllowedExternalUrl } from './util/external-url'
import { JobQueueService } from './services/job-queue'

const log = createLogger('main')

// Installed as early as possible so a crash during startup is still logged
// to disk. Previously, an uncaught exception or unhandled rejection in the
// main process crashed silently (visible only in Console.app on macOS, or
// nowhere at all in a packaged app) — nothing survived to disk for a
// supervising session (or the user) to find after the fact.
process.on('uncaughtException', (err) => {
  const detail = err.stack || err.message
  log.error(`Uncaught exception — the app will exit: ${detail}`)
  logEvent('crash', { source: 'uncaughtException', detail })
  recordLastError(detail)
  // The process is in an undefined state after this; exit deliberately
  // rather than risk continuing corrupted (this matches Node's own default
  // behavior — the difference is that now it's actually logged first).
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? (reason.stack || reason.message) : String(reason)
  log.error(`Unhandled promise rejection: ${detail}`)
  logEvent('crash', { source: 'unhandledRejection', detail })
  recordLastError(detail)
  // Unlike uncaughtException, a rejected promise doesn't necessarily leave
  // the whole process in a corrupted state — log and keep running rather
  // than taking down an otherwise-healthy app over one failed async call.
})

let mainWindow: BrowserWindow | null = null

// Two Zac the Ripper instances would double-open the SQLite DB and could
// race on the same optical drive — refuse to start a second instance and
// focus the existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // app.quit() only *requests* a quit — it's asynchronous and doesn't stop
  // execution of the rest of this file. Without a hard exit here, this
  // branch used to fall straight through to the unconditional
  // app.whenReady() below and fully boot a second instance anyway (its own
  // window, its own SQLite connection, its own disc-detection poller) —
  // exactly the DB/drive race this lock exists to prevent. Nothing of
  // value has happened yet at this point (no window, no DB, no processes),
  // so exiting immediately is safe.
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  // A second launch attempt while we're already running — surface the
  // existing window instead of doing nothing (or worse, letting a second
  // instance start ripping against the same drive).
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#09090b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Safe to enable: preload.ts only ever imports contextBridge/
      // ipcRenderer from 'electron' (both explicitly available to a
      // sandboxed preload) — no direct fs/child_process/etc. Node API
      // usage there to break. All real work already happens in the main
      // process behind the IPC bridge, which is the point of sandboxing.
      sandbox: true
    }
  })

  // Open external links in browser — allowlisted (see external-url.ts):
  // without this check, any window-open attempt (including from a
  // compromised/malicious response embedded in TMDB/MusicBrainz data)
  // would hand shell.openExternal an arbitrary url, not just https: links
  // to domains this app actually has a reason to open.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url)
    } else {
      log.warn(`Blocked window-open request to non-allowlisted url: ${url}`)
    }
    return { action: 'deny' }
  })

  // Register window for log forwarding
  setLogWindow(mainWindow)

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  logEvent('app_start', { pid: process.pid, version: app.getVersion() })

  // Initialize database
  initDatabase()

  // Anything still 'pending'/'running' in the DB predates this process launch
  // (the in-memory job queue never survives a restart) — a crash or force-quit
  // left it stuck. Reconcile before the UI reads job history.
  const reconciled = reconcileInterruptedJobs()
  if (reconciled > 0) {
    log.warn(`Reconciled ${reconciled} job(s) left running/pending by a previous session (marked failed)`)
  }

  // Clean up staging/artwork temp files orphaned by a previous crash.
  sweepStaleTempFiles()

  // Register IPC handlers
  registerAllIpcHandlers()

  // Renderer crashes (OOM, GPU crash, etc.) previously vanished — the window
  // just went blank/unresponsive with nothing recorded anywhere. A rip
  // continues in the main process regardless, but the user (or a supervising
  // session reading the logs) had no way to know the UI had died.
  app.on('render-process-gone', (_event, _webContents, details) => {
    const detail = `reason=${details.reason} exitCode=${details.exitCode}`
    log.error(`Renderer process gone: ${detail}`)
    logEvent('crash', { source: 'render-process-gone', detail })
    recordLastError(`Renderer process gone: ${detail}`)
  })

  app.on('child-process-gone', (_event, details) => {
    const detail = `type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
    log.error(`Child process gone: ${detail}`)
    logEvent('crash', { source: 'child-process-gone', detail })
  })

  // Periodic status.json snapshot + JSONL heartbeat — the "what's happening
  // right now" view a supervising session reads instead of reconstructing
  // state from the event stream. Also written immediately (not just on this
  // timer) wherever job state changes meaningfully — see JobQueueService.
  const jobQueue = JobQueueService.getInstance()
  const writeSnapshot = () => {
    writeStatusSnapshot(
      jobQueue.getActiveJobs().map(j => ({
        jobId: j.id, dbId: j.dbId, type: j.type, status: j.status,
        progress: j.progress, message: j.message
      })),
      app.getVersion()
    )
  }
  writeSnapshot()
  const snapshotInterval = setInterval(writeSnapshot, 5000)

  let heartbeatCount = 0
  const heartbeatInterval = setInterval(() => {
    heartbeatCount++
    logEvent('heartbeat', { count: heartbeatCount, activeJobs: jobQueue.getActiveJobs().length })
  }, 60000)

  app.on('will-quit', () => {
    clearInterval(snapshotInterval)
    clearInterval(heartbeatInterval)
  })

  // Create the main window
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let isQuitting = false

// Without this, quitting mid-rip (or mid-encode, mid-CD-rip) orphaned
// makemkvcon/ffmpeg/cdparanoia processes that kept running — and holding the
// optical drive — with no owner left to stop them, and left their jobs stuck
// 'running' in the DB until the next launch's reconcileInterruptedJobs() call.
app.on('before-quit', (event) => {
  if (isQuitting) return
  isQuitting = true
  event.preventDefault()

  logEvent('app_quit', { activeJobs: JobQueueService.getInstance().getActiveJobs().length })
  log.info('Quitting — stopping any active rip/encode processes...')
  try {
    JobQueueService.getInstance().killAllActiveProcesses()
  } catch (err) {
    log.error(`killAllActiveProcesses failed during quit: ${err}`)
  }

  // Give the graceful SIGTERM→SIGKILL escalation (process-runner.ts, 5s grace
  // period) a chance to actually finish before the process that owns those
  // timers exits — quitting immediately after sending SIGTERM would orphan
  // the follow-up SIGKILL for anything that ignores SIGTERM.
  setTimeout(() => app.quit(), 5500)
})
