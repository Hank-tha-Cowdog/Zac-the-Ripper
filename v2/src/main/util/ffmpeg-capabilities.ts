import { execFileSync } from 'child_process'
import { createLogger } from './logger'

const log = createLogger('ffmpeg-capabilities')

let zscaleSupportCache: boolean | null = null

/**
 * Whether this ffmpeg build has the zscale filter (requires --enable-libzimg
 * at compile time). Verified on this machine's Homebrew ffmpeg 8.0.1: it is
 * NOT included by default — `-filters` lists `tonemap` but not `zscale`.
 * Proper HDR→SDR tonemapping (linear-light zscale + tonemap + zscale back)
 * needs zscale; without it, PQ/HLG source data can't be correctly converted
 * and attempting the chain anyway fails outright ("Conversion failed!").
 *
 * Result is cached for the process lifetime — this is a one-time capability
 * check, not something that changes between encodes.
 */
export function hasZscaleSupport(ffmpegPath: string): boolean {
  if (zscaleSupportCache !== null) return zscaleSupportCache
  try {
    const output = execFileSync(ffmpegPath, ['-hide_banner', '-filters'], { timeout: 10000 }).toString()
    zscaleSupportCache = /\bzscale\b/.test(output)
  } catch (err) {
    log.warn(`Could not probe ffmpeg filter support: ${err}`)
    zscaleSupportCache = false
  }
  if (!zscaleSupportCache) {
    log.warn('ffmpeg build has no zscale filter — HDR-to-SDR tonemapping (H.264 preset, UHD downscale) is unavailable. ' +
      'Install an ffmpeg build with --enable-libzimg for correct HDR downscale handling.')
  }
  return zscaleSupportCache
}

/** Test-only escape hatch to reset the cache between test cases. */
export function _resetZscaleCacheForTesting(): void {
  zscaleSupportCache = null
}
