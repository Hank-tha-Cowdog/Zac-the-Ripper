import { existsSync, mkdirSync, statSync, appendFileSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'

/**
 * A simple size-based rotating file appender: once `filePath` exceeds
 * `maxBytes`, it's renamed to `<filePath>.1` (overwriting any previous one)
 * and a fresh file starts. No external logging dependency (winston/pino) —
 * this app's log volume doesn't need more than that.
 */
export class RotatingFile {
  constructor(
    private readonly dir: string,
    private readonly filename: string,
    private readonly maxBytes: number = 10 * 1024 * 1024
  ) {}

  private get filePath(): string {
    return join(this.dir, this.filename)
  }

  append(line: string): void {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
      this.rotateIfNeeded()
      appendFileSync(this.filePath, line.endsWith('\n') ? line : line + '\n')
    } catch {
      // Logging must never crash the app it's trying to observe — if the
      // disk is full or the path is unwritable, silently drop the line.
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.filePath)) return
    let size: number
    try {
      size = statSync(this.filePath).size
    } catch {
      return
    }
    if (size < this.maxBytes) return

    const rotated = `${this.filePath}.1`
    try {
      if (existsSync(rotated)) unlinkSync(rotated)
      renameSync(this.filePath, rotated)
    } catch {
      // If rotation fails (e.g. permissions), keep appending to the current
      // file rather than losing log output entirely.
    }
  }
}
