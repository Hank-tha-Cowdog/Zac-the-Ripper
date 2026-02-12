import { existsSync } from 'fs'
import { join } from 'path'

export type Platform = 'mac' | 'linux' | 'windows'

export function getPlatform(): Platform {
  switch (process.platform) {
    case 'darwin': return 'mac'
    case 'linux': return 'linux'
    case 'win32': return 'windows'
    default: return 'linux'
  }
}

export function isAppleSilicon(): boolean {
  return process.platform === 'darwin' && process.arch === 'arm64'
}

/**
 * Get the path to a bundled binary inside the app's Resources/bin/ directory.
 * Returns null if the binary doesn't exist at that location.
 */
export function getBundledBinPath(tool: string): string | null {
  // process.resourcesPath is set by Electron at runtime
  if (!process.resourcesPath) return null
  const binPath = join(process.resourcesPath, 'bin', tool)
  return existsSync(binPath) ? binPath : null
}

export function getDefaultToolPaths(): Record<string, string[]> {
  const platform = getPlatform()

  // Bundled paths are prepended (highest priority) by findToolPath
  switch (platform) {
    case 'mac':
      return {
        makemkvcon: [
          '/Applications/MakeMKV.app/Contents/MacOS/makemkvcon',
          '/usr/local/bin/makemkvcon',
          '/opt/homebrew/bin/makemkvcon'
        ],
        ffmpeg: [
          '/usr/local/bin/ffmpeg',
          '/opt/homebrew/bin/ffmpeg'
        ],
        ffprobe: [
          '/usr/local/bin/ffprobe',
          '/opt/homebrew/bin/ffprobe'
        ]
      }
    case 'linux':
      return {
        makemkvcon: ['/usr/bin/makemkvcon', '/usr/local/bin/makemkvcon'],
        ffmpeg: ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'],
        ffprobe: ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe']
      }
    case 'windows':
      return {
        makemkvcon: ['C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe'],
        ffmpeg: ['C:\\ffmpeg\\bin\\ffmpeg.exe'],
        ffprobe: ['C:\\ffmpeg\\bin\\ffprobe.exe']
      }
  }
}

export function findToolPath(tool: string): string | null {
  // Check bundled binary first (highest priority)
  const bundled = getBundledBinPath(tool)
  if (bundled) return bundled

  // Fall back to system paths
  const paths = getDefaultToolPaths()[tool] || []
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return null
}
