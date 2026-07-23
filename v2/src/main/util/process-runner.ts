import { spawn, ChildProcess } from 'child_process'
import { createWriteStream, mkdirSync, WriteStream } from 'fs'
import { dirname } from 'path'
import { createLogger } from './logger'

const log = createLogger('process-runner')

export interface ProcessOptions {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
  onExit?: (code: number | null, signal: string | null) => void
  /** Fired when the process fails to spawn at all (e.g. ENOENT) — the plain
   * onExit(-1, null) call still fires too, for callers that only check code. */
  onError?: (err: Error) => void
  /** Grace period before escalating from SIGTERM to SIGKILL, in ms. Default 5000. */
  killGraceMs?: number
  /** If set, tee raw stdout+stderr to this file (created, parent dir made if
   * needed). Used for per-job full tool transcripts — a failed rip's raw
   * MakeMKV/ffmpeg/cdparanoia output survives for diagnosis, not just the
   * filtered subset that reaches onStdout/onStderr (e.g. stderr is commonly
   * logged at debug level only, which is invisible at the default log level). */
  transcriptPath?: string
}

export interface RunningProcess {
  pid: number
  process: ChildProcess
  kill: () => void
  waitForExit: () => Promise<number | null>
}

export function runProcess(options: ProcessOptions): RunningProcess {
  const { command, args, cwd, env, onStdout, onStderr, onExit, onError, killGraceMs = 5000, transcriptPath } = options
  const commandName = command.split('/').pop() || command

  log.info(`Spawning: ${command} ${args.join(' ')}`)

  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let transcript: WriteStream | null = null
  if (transcriptPath) {
    try {
      mkdirSync(dirname(transcriptPath), { recursive: true })
      transcript = createWriteStream(transcriptPath, { flags: 'a' })
      transcript.write(`\n===== ${new Date().toISOString()} spawn: ${command} ${args.join(' ')} (pid ${child.pid}) =====\n`)
    } catch (err) {
      log.warn(`Could not open transcript file ${transcriptPath}: ${err}`)
    }
  }

  let stdoutBuffer = ''
  let stderrBuffer = ''
  // Tracks actual process termination — NOT the same as ChildProcess.killed,
  // which Node sets true the moment a kill signal is *sent*, not when the
  // process actually dies. Checking .killed for SIGKILL escalation means the
  // escalation can never fire (see kill() below).
  let exited = false
  let settled = false

  // Split on \n OR \r: tools with an in-place-updating progress display
  // (cdparanoia's "(== PROGRESS == ..." bar, ffmpeg's human stats line)
  // separate successive updates with a bare \r and never emit \n until a
  // real newline-worthy event. Splitting on \n alone means those updates
  // sit in the buffer and never reach onStdout/onStderr until the process
  // exits and the trailing buffer is flushed — i.e. no live progress at all.
  const LINE_SPLIT = /\r\n|\r|\n/

  child.stdout?.on('data', (data: Buffer) => {
    transcript?.write(data)
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split(LINE_SPLIT)
    stdoutBuffer = lines.pop() || ''
    for (const line of lines) {
      if (line.trim()) onStdout?.(line)
    }
  })

  child.stderr?.on('data', (data: Buffer) => {
    transcript?.write(data)
    stderrBuffer += data.toString()
    const lines = stderrBuffer.split(LINE_SPLIT)
    stderrBuffer = lines.pop() || ''
    for (const line of lines) {
      if (line.trim()) onStderr?.(line)
    }
  })

  const exitPromise = new Promise<number | null>((resolve) => {
    // 'error' and 'exit' can both fire for the same child (Node's own docs
    // warn about this) — settle only once so onExit isn't dispatched twice.
    const settle = (code: number | null, signal: string | null) => {
      exited = true
      if (settled) return
      settled = true
      onExit?.(code, signal)
      resolve(code)
    }

    child.on('exit', (code, signal) => {
      // Flush remaining buffers
      if (stdoutBuffer.trim()) onStdout?.(stdoutBuffer.trim())
      if (stderrBuffer.trim()) onStderr?.(stderrBuffer.trim())

      log.info(`Process exited: pid=${child.pid} cmd=${commandName} code=${code} signal=${signal}`)
      transcript?.end(`===== exited: code=${code} signal=${signal} =====\n`)
      settle(code, signal)
    })

    child.on('error', (err) => {
      log.error(`Process error: pid=${child.pid} cmd=${commandName} ${err.message}`)
      transcript?.end(`===== spawn error: ${err.message} =====\n`)
      onError?.(err)
      settle(-1, null)
    })
  })

  return {
    pid: child.pid || -1,
    process: child,
    kill: () => {
      if (exited) return
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!exited) {
          log.warn(`pid=${child.pid} cmd=${commandName} did not exit within ${killGraceMs}ms of SIGTERM — sending SIGKILL`)
          child.kill('SIGKILL')
        }
      }, killGraceMs)
    },
    waitForExit: () => exitPromise
  }
}
