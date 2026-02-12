import { spawn, ChildProcess } from 'child_process'
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
}

export interface RunningProcess {
  pid: number
  process: ChildProcess
  kill: () => void
  waitForExit: () => Promise<number | null>
}

export function runProcess(options: ProcessOptions): RunningProcess {
  const { command, args, cwd, env, onStdout, onStderr, onExit } = options

  log.info(`Spawning: ${command} ${args.join(' ')}`)

  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let stdoutBuffer = ''
  let stderrBuffer = ''

  child.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() || ''
    for (const line of lines) {
      if (line.trim()) onStdout?.(line)
    }
  })

  child.stderr?.on('data', (data: Buffer) => {
    stderrBuffer += data.toString()
    const lines = stderrBuffer.split('\n')
    stderrBuffer = lines.pop() || ''
    for (const line of lines) {
      if (line.trim()) onStderr?.(line)
    }
  })

  const exitPromise = new Promise<number | null>((resolve) => {
    child.on('exit', (code, signal) => {
      // Flush remaining buffers
      if (stdoutBuffer.trim()) onStdout?.(stdoutBuffer.trim())
      if (stderrBuffer.trim()) onStderr?.(stderrBuffer.trim())

      log.info(`Process exited: code=${code} signal=${signal}`)
      onExit?.(code, signal)
      resolve(code)
    })

    child.on('error', (err) => {
      log.error(`Process error: ${err.message}`)
      onExit?.(-1, null)
      resolve(-1)
    })
  })

  return {
    pid: child.pid || -1,
    process: child,
    kill: () => {
      if (!child.killed) {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 5000)
      }
    },
    waitForExit: () => exitPromise
  }
}
