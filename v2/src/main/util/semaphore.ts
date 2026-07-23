/**
 * Bounds how many async tasks run concurrently. Used to cap concurrent
 * ffmpeg encodes — without it, a multi-title rip with FFV1 + streaming both
 * enabled fires all titles' encodes at once (N titles × 2 presets = N×2
 * concurrent ffmpeg processes), saturating CPU/disk with no back-pressure.
 */
export class Semaphore {
  private available: number
  private readonly waiters: Array<() => void> = []

  constructor(maxConcurrent: number) {
    this.available = maxConcurrent
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--
      return () => this.release()
    }
    await new Promise<void>(resolve => this.waiters.push(resolve))
    this.available--
    return () => this.release()
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await task()
    } finally {
      release()
    }
  }

  private release(): void {
    this.available++
    const next = this.waiters.shift()
    if (next) next()
  }
}
