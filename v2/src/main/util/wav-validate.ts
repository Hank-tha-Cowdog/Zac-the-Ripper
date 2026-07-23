import { existsSync, statSync, openSync, readSync, closeSync } from 'fs'

/** Bytes per raw CD audio sector: 44.1kHz, 16-bit, stereo (75 sectors/sec = 176400 bytes/sec). */
export const CD_BYTES_PER_SECTOR = 2352

export interface WavValidationResult {
  valid: boolean
  reason?: string
  actualBytes?: number
  expectedBytes?: number
}

/**
 * Validates a cdparanoia WAV output file actually contains real audio data.
 *
 * Needed because cdparanoia's own exit code is not a reliable success
 * signal: verified against its source (main.c) that it calls exit(0) even
 * when a track was skipped and its output file unlinked after
 * uncorrectable read errors. A truncated/empty/missing file can therefore
 * exit 0 — this checks the RIFF/WAVE header and that the file's byte size
 * is consistent with the track's known sector length, rather than trusting
 * the exit code or mere file existence.
 */
export function validateWavFile(path: string, expectedSectors: number): WavValidationResult {
  if (!existsSync(path)) {
    return { valid: false, reason: 'output file does not exist' }
  }

  const stat = statSync(path)
  if (stat.size < 44) {
    return { valid: false, reason: `file too small to contain a WAV header (${stat.size} bytes)`, actualBytes: stat.size }
  }

  const header = Buffer.alloc(12)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, header, 0, 12, 0)
  } finally {
    closeSync(fd)
  }

  const riffMagic = header.toString('ascii', 0, 4)
  const waveMagic = header.toString('ascii', 8, 12)
  if (riffMagic !== 'RIFF' || waveMagic !== 'WAVE') {
    return { valid: false, reason: `not a valid WAV file (RIFF="${riffMagic}" WAVE="${waveMagic}")`, actualBytes: stat.size }
  }

  const expectedBytes = expectedSectors * CD_BYTES_PER_SECTOR
  // Small tolerance below the expected size — cdparanoia's exact byte count
  // can vary by a sector or two at track boundaries — but a file far
  // shorter than expected signals a truncated/skipped rip.
  const minAcceptableBytes = expectedBytes * 0.95
  if (stat.size < minAcceptableBytes) {
    return {
      valid: false,
      reason: `file is far shorter than expected (${stat.size} bytes, expected ~${expectedBytes})`,
      actualBytes: stat.size,
      expectedBytes
    }
  }

  return { valid: true, actualBytes: stat.size, expectedBytes }
}
