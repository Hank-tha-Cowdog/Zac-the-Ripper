import { Readable } from 'stream'
import { openSync, readSync, closeSync } from 'fs'
import { createLogger } from './logger'

const log = createLogger('tail-reader')

/**
 * A Readable stream that reads a file as it grows (like `tail -f`).
 *
 * Usage:
 *   const reader = new TailFileReader('/tmp/growing.mkv')
 *   reader.pipe(ffmpegProcess.stdin)
 *   // ... when the writer process finishes:
 *   reader.signalWriterDone()
 *   // TailFileReader will read remaining bytes and emit EOF
 */
export class TailFileReader extends Readable {
  private fd: number | null = null
  private position = 0
  private writerDone = false
  private retryCount = 0
  private maxRetries = 200 // 200 * 50ms = 10s max wait for new data
  private pollMs = 50

  constructor(
    private filePath: string,
    opts?: { highWaterMark?: number; pollMs?: number }
  ) {
    super({ highWaterMark: opts?.highWaterMark || 256 * 1024 }) // 256KB chunks
    if (opts?.pollMs) this.pollMs = opts.pollMs
    log.info(`[tail] Created reader for ${filePath} (hwm=${this.readableHighWaterMark}, poll=${this.pollMs}ms)`)
  }

  /** Call this when the writer process has exited. Reader will drain remaining bytes and emit EOF. */
  signalWriterDone(): void {
    log.info(`[tail] Writer done signal — position=${this.position} bytes read so far`)
    this.writerDone = true
  }

  _read(size: number): void {
    if (this.fd === null) {
      try {
        this.fd = openSync(this.filePath, 'r')
        log.info(`[tail] Opened ${this.filePath} for reading`)
      } catch (err) {
        log.error(`[tail] Failed to open ${this.filePath}: ${err}`)
        this.destroy(err as Error)
        return
      }
    }

    const chunkSize = Math.min(size, 256 * 1024)
    const buf = Buffer.allocUnsafe(chunkSize)

    try {
      const bytesRead = readSync(this.fd, buf, 0, chunkSize, this.position)

      if (bytesRead > 0) {
        this.position += bytesRead
        this.retryCount = 0 // reset retry counter on successful read
        this.push(buf.subarray(0, bytesRead))
      } else if (this.writerDone) {
        // Writer is done — do one final drain pass
        const finalBuf = Buffer.allocUnsafe(64 * 1024)
        const finalBytes = readSync(this.fd, finalBuf, 0, finalBuf.length, this.position)
        if (finalBytes > 0) {
          this.position += finalBytes
          this.push(finalBuf.subarray(0, finalBytes))
        } else {
          // Truly done
          log.info(`[tail] EOF — ${this.position} bytes total from ${this.filePath}`)
          this.cleanup()
          this.push(null)
        }
      } else {
        // No data yet but writer still active — poll
        this.retryCount++
        if (this.retryCount > this.maxRetries) {
          log.warn(`[tail] No new data for ${(this.retryCount * this.pollMs / 1000).toFixed(1)}s — still waiting...`)
          this.retryCount = 0 // reset to prevent log spam, keep waiting
        }
        setTimeout(() => this._read(size), this.pollMs)
      }
    } catch (err) {
      log.error(`[tail] Read error at position ${this.position}: ${err}`)
      this.cleanup()
      this.destroy(err as Error)
    }
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.cleanup()
    callback(error)
  }

  private cleanup(): void {
    if (this.fd !== null) {
      try { closeSync(this.fd) } catch {}
      this.fd = null
    }
  }
}
