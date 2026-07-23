import { describe, it, expect } from 'vitest'
import { runProcess } from './process-runner'

describe('runProcess kill escalation', () => {
  it('escalates to SIGKILL when the process ignores SIGTERM', async () => {
    // trap '' TERM makes bash ignore SIGTERM entirely — the process can only
    // die via SIGKILL (untrappable) or the sleep completing on its own.
    const proc = runProcess({
      command: 'bash',
      args: ['-c', 'trap "" TERM; sleep 30'],
      killGraceMs: 200
    })

    const exitPromise = proc.waitForExit()
    proc.kill()

    const code = await exitPromise
    // A SIGKILL'd process reports exit code null with signal SIGKILL (Node
    // convention) — not a graceful exit code.
    expect(code).toBeNull()
  }, 10000)

  it('resolves promptly when the process honors SIGTERM', async () => {
    const proc = runProcess({
      command: 'bash',
      args: ['-c', 'sleep 30'],
      killGraceMs: 5000
    })

    const start = Date.now()
    const exitPromise = proc.waitForExit()
    proc.kill()
    await exitPromise
    const elapsed = Date.now() - start

    // Should exit via plain SIGTERM almost immediately, well under the 5s
    // SIGKILL escalation window — proves escalation doesn't fire needlessly.
    expect(elapsed).toBeLessThan(2000)
  }, 10000)

  it('does not escalate twice for a process that exits between exit and error events', async () => {
    const proc = runProcess({
      command: 'bash',
      args: ['-c', 'exit 0'],
      killGraceMs: 100
    })

    const code = await proc.waitForExit()
    expect(code).toBe(0)

    // kill() after the process has already exited should be a safe no-op,
    // not throw or hang.
    expect(() => proc.kill()).not.toThrow()
  })
})

describe('runProcess line splitting', () => {
  it('flushes \\r-separated updates as they arrive, not only at exit', async () => {
    // Real tools with an in-place progress bar (cdparanoia, ffmpeg's human
    // stats line) separate updates with a bare \r, never \n, until the
    // process is done. Splitting on \n alone would buffer everything and
    // deliver it as one lump at exit — i.e. no live progress.
    const seen: string[] = []
    const proc = runProcess({
      command: 'bash',
      args: ['-c', 'printf "progress 10\\rprogress 55\\rprogress 100\\n"; sleep 0.3; echo done'],
      onStdout: (line) => seen.push(line)
    })

    await proc.waitForExit()
    expect(seen).toEqual(['progress 10', 'progress 55', 'progress 100', 'done'])
  }, 10000)

  it('still splits normally on plain \\n-only output (no regression)', async () => {
    const seen: string[] = []
    const proc = runProcess({
      command: 'bash',
      args: ['-c', 'echo line1; echo line2; echo line3'],
      onStdout: (line) => seen.push(line)
    })

    await proc.waitForExit()
    expect(seen).toEqual(['line1', 'line2', 'line3'])
  })
})
