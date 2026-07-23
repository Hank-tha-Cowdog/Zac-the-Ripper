/**
 * Pure parsing of cdparanoia's live progress line (emitted to stderr when
 * run with -e/--stderr-progress).
 *
 * VERIFIED against cdparanoia's own source (main.c, oe-mirrors/cdparanoia
 * mirror of the xiph.org SVN trunk): the line is built from the format
 * string
 *
 *   "\r (== PROGRESS == [%s| %06ld %02d ] ==%s %c ==) "
 *
 * i.e. a dispcache status string, a zero-padded ABSOLUTE sector number
 * (v_sector — the drive's raw LBA position, same addressing space as
 * CDTrackInfo.startSector/endSector), an overlap count, a smilie, and a
 * heartbeat character. Real captured sample:
 *
 *   (== PROGRESS == [ | 009802 00 ] == :^D * ==)
 *
 * The previous parser looked for a literal "[XX.X%]" percentage — a format
 * cdparanoia has never emitted; it reports only the raw sector position,
 * never a percentage. That regex could never match real output, so
 * onProgress was never called during a rip (0% until the track finished).
 */
const PROGRESS_LINE = /\(==\s*PROGRESS\s*==\s*\[[^|]*\|\s*(\d+)\s+\d+\s*\]/

export function parseCdparanoiaProgressSector(line: string): number | null {
  const match = line.match(PROGRESS_LINE)
  if (!match) return null
  const sector = parseInt(match[1], 10)
  return Number.isNaN(sector) ? null : sector
}

/**
 * Converts an absolute disc sector position into a 0-100 percentage within
 * one track's [startSector, endSector] range. Clamped defensively — v_sector
 * is documented as absolute LBA, consistent with cdparanoia's multi-track
 * "Ripping from sector X to sector Y" range header using the same absolute
 * addressing, but this hasn't been confirmed against a live drive on this
 * machine, so a slightly-out-of-range reading degrades to a clamped percent
 * instead of a nonsensical negative/>100 value.
 */
export function cdparanoiaSectorToPercent(sector: number, startSector: number, endSector: number): number {
  const trackLength = endSector - startSector + 1
  if (trackLength <= 0) return 0
  const percent = ((sector - startSector) / trackLength) * 100
  return Math.max(0, Math.min(100, percent))
}
