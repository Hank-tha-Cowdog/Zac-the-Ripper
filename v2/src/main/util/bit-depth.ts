/**
 * Detects video bit depth, preferring ffprobe's bits_per_raw_sample field
 * when present but falling back to parsing the pix_fmt string — verified
 * against real encoder output that ffprobe omits bits_per_raw_sample
 * entirely for 10-bit HEVC (both hevc_videotoolbox and libx265 output), so
 * relying on it alone silently misreports 10-bit sources as 8-bit. pix_fmt
 * reliably carries the bit depth as a numeric suffix before le/be (e.g.
 * "yuv420p10le", "yuv420p12le"); no suffix means 8-bit.
 */
export function detectBitDepth(pixelFormat: string, bitsPerRawSample?: unknown): number {
  const explicit = parseInt(String(bitsPerRawSample), 10)
  if (Number.isFinite(explicit) && explicit > 0) return explicit

  const match = pixelFormat.match(/(\d+)(?:le|be)$/)
  if (match) return parseInt(match[1], 10)

  return 8
}
