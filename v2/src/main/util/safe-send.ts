import { BrowserWindow } from 'electron'

/**
 * Send an IPC event to a renderer window, silently no-oping if the window has
 * been closed/destroyed. Without this guard, sending to a destroyed window's
 * webContents throws synchronously inside whatever process-output callback
 * triggered the send (child stdout handlers, progress callbacks) — and on
 * macOS, where the app keeps running after the last window closes, that
 * throw can abort an in-progress rip/encode pipeline entirely just because
 * the user closed the window.
 */
export function safeSend(window: BrowserWindow | null | undefined, channel: string, ...args: unknown[]): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(channel, ...args)
}
