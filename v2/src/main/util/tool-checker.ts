import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { getSetting, setSetting } from '../database/queries/settings'
import { findToolPath, getBundledBinPath } from './platform'
import { createLogger } from './logger'

const execFileAsync = promisify(execFile)
const log = createLogger('tool-checker')

export interface ToolStatus {
  name: string
  path: string | null
  available: boolean
  version: string | null
}

async function getToolVersion(name: string, path: string): Promise<string | null> {
  try {
    let args: string[]
    switch (name) {
      case 'makemkvcon':
        args = ['info', '--robot', '--noscan']
        break
      case 'ffmpeg':
      case 'ffprobe':
      case 'ffplay':
        args = ['-version']
        break
      case 'mpv':
        args = ['--version']
        break
      default:
        args = ['--version']
    }

    // execFileAsync throws on non-zero exit codes, but some tools (like makemkvcon)
    // exit with code 1 even when working correctly. Catch and inspect output.
    let stdout = ''
    try {
      const result = await execFileAsync(path, args, { timeout: 10000 })
      stdout = result.stdout
    } catch (execErr: unknown) {
      // If the process ran but exited non-zero, we still get stdout/stderr
      const err = execErr as { stdout?: string; stderr?: string; code?: number }
      if (err.stdout) {
        stdout = err.stdout
      } else {
        throw execErr
      }
    }

    if (name === 'ffmpeg' || name === 'ffprobe' || name === 'ffplay') {
      const match = stdout.match(/version\s+([\d.]+)/)
      return match ? match[1] : stdout.split('\n')[0]
    }

    // makemkvcon: parse version from MSG line like MSG:1005,0,1,"MakeMKV v1.18.3..."
    if (name === 'makemkvcon') {
      const versionMatch = stdout.match(/MakeMKV v([\d.]+)/)
      if (versionMatch) return versionMatch[1]
    }

    // mpv: version line like "mpv 0.37.0"
    if (name === 'mpv') {
      const versionMatch = stdout.match(/mpv\s+([\d.]+)/)
      if (versionMatch) return versionMatch[1]
    }

    return stdout.split('\n')[0] || 'installed'
  } catch (err) {
    log.warn(`Could not get version for ${name}: ${err}`)
    return null
  }
}

export async function checkTools(): Promise<ToolStatus[]> {
  const tools = ['makemkvcon', 'ffmpeg', 'ffprobe', 'mpv', 'ffplay']
  const results: ToolStatus[] = []

  for (const tool of tools) {
    // Priority: bundled binary > DB setting > system path search
    const bundled = getBundledBinPath(tool)
    const settingPath = getSetting(`tools.${tool}_path`)
    const path = (bundled && existsSync(bundled))
      ? bundled
      : (settingPath && existsSync(settingPath))
        ? settingPath
        : findToolPath(tool)

    if (path && existsSync(path)) {
      const version = await getToolVersion(tool, path)
      const available = version !== null

      // Auto-save discovered path so subsequent checks are faster
      if (available && path !== settingPath) {
        try { setSetting(`tools.${tool}_path`, path) } catch { /* DB might not be ready */ }
      }

      results.push({ name: tool, path, available, version })
    } else {
      results.push({ name: tool, path: null, available: false, version: null })
    }
  }

  return results
}

export async function testTool(name: string, path: string): Promise<{ available: boolean; version: string | null; error?: string }> {
  if (!existsSync(path)) {
    return { available: false, version: null, error: 'File not found' }
  }

  const version = await getToolVersion(name, path)
  return { available: version !== null, version }
}
