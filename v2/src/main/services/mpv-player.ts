import { ChildProcess, spawn } from 'child_process'
import * as net from 'net'
import { existsSync, unlinkSync } from 'fs'
import { findToolPath } from '../util/platform'
import { createLogger } from '../util/logger'

const log = createLogger('mpv-player')

export interface PlaybackState {
  playing: boolean
  position: number
  duration: number
  chapter: number
  chapterCount: number
  audioTrack: number
  audioTracks: { id: number; title: string; lang: string }[]
  subtitleTrack: number | false
  subtitleTracks: { id: number; title: string; lang: string }[]
  volume: number
  title: number
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

export class MpvPlayerService {
  private process: ChildProcess | null = null
  private socket: net.Socket | null = null
  private socketPath = '/tmp/ztr-mpv.sock'
  private requestId = 0
  private pendingRequests = new Map<number, PendingRequest>()
  private state: PlaybackState = this.defaultState()
  private buffer = ''
  private stateCallback: ((state: PlaybackState) => void) | null = null
  private isFfplay = false

  private defaultState(): PlaybackState {
    return {
      playing: false,
      position: 0,
      duration: 0,
      chapter: 0,
      chapterCount: 0,
      audioTrack: 1,
      audioTracks: [],
      subtitleTrack: false,
      subtitleTracks: [],
      volume: 100,
      title: 0
    }
  }

  onStateUpdate(callback: (state: PlaybackState) => void): void {
    this.stateCallback = callback
  }

  async start(opts: { dvdDevice: string; titleIndex: number }): Promise<{ player: 'mpv' | 'ffplay' | 'none' }> {
    await this.stop()

    const mpvPath = findToolPath('mpv')
    if (mpvPath) {
      await this.startMpv(mpvPath, opts)
      return { player: 'mpv' }
    }

    const ffplayPath = findToolPath('ffplay')
    if (ffplayPath) {
      this.startFfplay(ffplayPath, opts)
      return { player: 'ffplay' }
    }

    return { player: 'none' }
  }

  private async startMpv(mpvPath: string, opts: { dvdDevice: string; titleIndex: number }): Promise<void> {
    this.isFfplay = false
    this.state = this.defaultState()
    this.state.title = opts.titleIndex

    // Clean up stale socket
    if (existsSync(this.socketPath)) {
      try { unlinkSync(this.socketPath) } catch {}
    }

    const args = [
      `dvd://${opts.titleIndex}`,
      `--dvd-device=${opts.dvdDevice}`,
      `--input-ipc-server=${this.socketPath}`,
      '--no-terminal',
      '--keep-open=yes',
      '--idle=no',
      '--hwdec=auto',
      '--force-window=yes',
      '--no-border',
      '--title=ZTR Preview',
      '--no-osc',
      '--no-input-default-bindings',
      '--volume=100'
    ]

    log.info(`Starting mpv: ${mpvPath} ${args.join(' ')}`)

    this.process = spawn(mpvPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process.stdout?.on('data', (data) => {
      log.debug(`mpv stdout: ${data.toString().trim()}`)
    })

    this.process.stderr?.on('data', (data) => {
      log.debug(`mpv stderr: ${data.toString().trim()}`)
    })

    this.process.on('exit', (code) => {
      log.info(`mpv exited with code ${code}`)
      this.cleanup()
    })

    this.process.on('error', (err) => {
      log.error(`mpv process error: ${err.message}`)
      this.cleanup()
    })

    // Wait for the socket to appear, then connect
    await this.waitForSocket(5000)
    await this.connectSocket()

    // Observe properties for real-time updates
    await this.observeProperty('pause')
    await this.observeProperty('time-pos')
    await this.observeProperty('duration')
    await this.observeProperty('chapter')
    await this.observeProperty('chapters')
    await this.observeProperty('aid')
    await this.observeProperty('sid')
    await this.observeProperty('volume')
    await this.observeProperty('track-list')
  }

  private startFfplay(ffplayPath: string, opts: { dvdDevice: string; titleIndex: number }): void {
    this.isFfplay = true
    this.state = this.defaultState()
    this.state.title = opts.titleIndex

    const args = [
      `dvd://${opts.titleIndex}`,
      '-dvd_device', opts.dvdDevice,
      '-x', '960',
      '-y', '540',
      '-noborder',
      '-window_title', 'ZTR Preview'
    ]

    log.info(`Starting ffplay: ${ffplayPath} ${args.join(' ')}`)

    this.process = spawn(ffplayPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process.on('exit', (code) => {
      log.info(`ffplay exited with code ${code}`)
      this.cleanup()
    })

    this.process.on('error', (err) => {
      log.error(`ffplay process error: ${err.message}`)
      this.cleanup()
    })

    // ffplay has no IPC — state remains at defaults, playing=true
    this.state.playing = true
    this.emitState()
  }

  private waitForSocket(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const check = () => {
        if (existsSync(this.socketPath)) {
          resolve()
          return
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Timed out waiting for mpv socket'))
          return
        }
        setTimeout(check, 100)
      }
      check()
    })
  }

  private connectSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath)

      this.socket.on('connect', () => {
        log.info('Connected to mpv IPC socket')
        resolve()
      })

      this.socket.on('error', (err) => {
        log.error(`mpv socket error: ${err.message}`)
        reject(err)
      })

      this.socket.on('data', (data) => {
        this.buffer += data.toString()
        this.processBuffer()
      })

      this.socket.on('close', () => {
        log.debug('mpv socket closed')
        this.socket = null
      })
    })
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n')
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        this.handleMessage(msg)
      } catch {
        log.debug(`Non-JSON mpv message: ${line}`)
      }
    }
  }

  private handleMessage(msg: { event?: string; request_id?: number; data?: unknown; error?: string; name?: string }): void {
    // Handle command responses
    if (msg.request_id !== undefined) {
      const pending = this.pendingRequests.get(msg.request_id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(msg.request_id)
        if (msg.error && msg.error !== 'success') {
          pending.reject(new Error(msg.error))
        } else {
          pending.resolve(msg.data)
        }
      }
      return
    }

    // Handle property change events
    if (msg.event === 'property-change' && msg.name) {
      this.handlePropertyChange(msg.name, msg.data)
    }
  }

  private handlePropertyChange(name: string, value: unknown): void {
    switch (name) {
      case 'pause':
        this.state.playing = !(value as boolean)
        break
      case 'time-pos':
        if (typeof value === 'number') this.state.position = value
        break
      case 'duration':
        if (typeof value === 'number') this.state.duration = value
        break
      case 'chapter':
        if (typeof value === 'number') this.state.chapter = value
        break
      case 'chapters':
        if (typeof value === 'number') this.state.chapterCount = value
        break
      case 'aid':
        if (typeof value === 'number') this.state.audioTrack = value
        break
      case 'sid':
        this.state.subtitleTrack = typeof value === 'number' ? value : false
        break
      case 'volume':
        if (typeof value === 'number') this.state.volume = value
        break
      case 'track-list':
        if (Array.isArray(value)) {
          this.state.audioTracks = value
            .filter((t: { type: string }) => t.type === 'audio')
            .map((t: { id: number; title?: string; lang?: string }) => ({
              id: t.id,
              title: t.title || `Track ${t.id}`,
              lang: t.lang || ''
            }))
          this.state.subtitleTracks = value
            .filter((t: { type: string }) => t.type === 'sub')
            .map((t: { id: number; title?: string; lang?: string }) => ({
              id: t.id,
              title: t.title || `Sub ${t.id}`,
              lang: t.lang || ''
            }))
        }
        break
    }
    this.emitState()
  }

  private emitState(): void {
    if (this.stateCallback) {
      this.stateCallback({ ...this.state })
    }
  }

  async command(cmd: unknown[]): Promise<unknown> {
    if (!this.socket || this.isFfplay) return null

    const id = ++this.requestId
    const payload = JSON.stringify({ command: cmd, request_id: id }) + '\n'

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`mpv command timed out: ${JSON.stringify(cmd)}`))
      }, 5000)

      this.pendingRequests.set(id, { resolve, reject, timer })
      this.socket!.write(payload)
    })
  }

  async getProperty(name: string): Promise<unknown> {
    return this.command(['get_property', name])
  }

  async setProperty(name: string, value: unknown): Promise<void> {
    await this.command(['set_property', name, value])
  }

  async observeProperty(name: string): Promise<void> {
    const id = ++this.requestId
    const payload = JSON.stringify({ command: ['observe_property', id, name], request_id: id }) + '\n'
    this.socket?.write(payload)
  }

  // High-level controls
  async play(): Promise<void> {
    await this.setProperty('pause', false)
  }

  async pause(): Promise<void> {
    await this.setProperty('pause', true)
  }

  async togglePause(): Promise<void> {
    await this.command(['cycle', 'pause'])
  }

  async seek(seconds: number): Promise<void> {
    await this.command(['seek', seconds, 'relative'])
  }

  async seekAbsolute(seconds: number): Promise<void> {
    await this.command(['seek', seconds, 'absolute'])
  }

  async setChapter(index: number): Promise<void> {
    await this.setProperty('chapter', index)
  }

  async nextChapter(): Promise<void> {
    await this.command(['add', 'chapter', 1])
  }

  async prevChapter(): Promise<void> {
    await this.command(['add', 'chapter', -1])
  }

  async setAudioTrack(id: number): Promise<void> {
    await this.setProperty('aid', id)
  }

  async setSubtitleTrack(id: number | false): Promise<void> {
    await this.setProperty('sid', id === false ? 'no' : id)
  }

  async setVolume(vol: number): Promise<void> {
    await this.setProperty('volume', vol)
  }

  getPlaybackState(): PlaybackState {
    return { ...this.state }
  }

  get isRunning(): boolean {
    return this.process !== null
  }

  get isUsingFfplay(): boolean {
    return this.isFfplay
  }

  async stop(): Promise<void> {
    // Send quit command if socket is active
    if (this.socket && !this.isFfplay) {
      try {
        await this.command(['quit'])
      } catch {
        // Ignore errors during shutdown
      }
    }

    // Kill the process if still running
    if (this.process) {
      try {
        this.process.kill('SIGTERM')
      } catch {}
      // Force kill after 2 seconds
      const proc = this.process
      setTimeout(() => {
        try { proc.kill('SIGKILL') } catch {}
      }, 2000)
    }

    this.cleanup()
  }

  private cleanup(): void {
    // Clear pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('mpv shutting down'))
    }
    this.pendingRequests.clear()

    if (this.socket) {
      try { this.socket.destroy() } catch {}
      this.socket = null
    }

    this.process = null
    this.state = this.defaultState()
    this.buffer = ''

    // Clean up socket file
    if (existsSync(this.socketPath)) {
      try { unlinkSync(this.socketPath) } catch {}
    }
  }
}

// Singleton
let instance: MpvPlayerService | null = null

export function getMpvService(): MpvPlayerService {
  if (!instance) {
    instance = new MpvPlayerService()
  }
  return instance
}
