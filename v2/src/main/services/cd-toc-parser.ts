export interface CDTrackInfo {
  number: number
  startSector: number
  endSector: number
  durationSeconds: number
}

export interface CDDiscInfo {
  trackCount: number
  tracks: CDTrackInfo[]
  leadOutSector: number
  totalDurationSeconds: number
  devicePath: string
  /** MusicBrainz DiscID LBA offsets (+150 lead-in shift applied) — see doc comment on parseCDToc. */
  trackOffsets: number[]
}

/**
 * Pure parsing of `cdparanoia -Q` output. Extracted from CDRipperService so
 * the MusicBrainz DiscID offset math (previously missing entirely — see
 * below) can be unit-tested against realistic fixture output without a
 * physical CD or working cdparanoia install.
 *
 * Format:
 *   track  length    begin    copy pre ch
 *   ===========================================================
 *     1.   18000 [04:00.00]        0 [00:00.00]    no   no  2
 *     2.   22350 [04:58.00]    18000 [04:00.00]    no   no  2
 *   TOTAL  40200 [08:56.00]    (audio only)
 *
 * cdparanoia's "begin" column is a raw drive LBA, 0-based at track 1 — this
 * is what real cdparanoia -Q reports. CDTrackInfo.startSector stores that
 * raw value, used for actual ripping via `cdparanoia -w N`, which expects
 * raw track numbers/LBA, not MSF-shifted ones.
 *
 * trackOffsets (and leadOutSector) are a SEPARATE, MusicBrainz-specific
 * concept: the DiscID spec requires LBA values shifted by +150 sectors
 * (verified against the official spec at musicbrainz.org/doc/Disc_ID_Calculation:
 * "the LBA offsets start at address 0, but the first track starts actually
 * at 00:02:00 ... so we need to add 150 logical blocks to each LBA
 * offset" — applied to the lead-out the same way, since it's the same kind
 * of LBA-style position value). Previously this addition happened nowhere
 * in the pipeline, so calculateDiscId always hashed raw (unshifted)
 * values, meaning the computed disc ID essentially never matched
 * MusicBrainz's database.
 */
const MSF_LEAD_IN_OFFSET = 150

export function parseCDToc(output: string, devicePath: string): CDDiscInfo | null {
  const lines = output.split('\n')
  const tracks: CDTrackInfo[] = []
  let leadOutSector = 0
  const trackOffsets: number[] = []

  for (const line of lines) {
    // Match track lines: "  1.   18000 [04:00.00]      150 [00:02.00]    no   no  2"
    const trackMatch = line.match(/^\s*(\d+)\.\s+(\d+)\s+\[[\d:.]+\]\s+(\d+)\s+\[[\d:.]+\]/)
    if (trackMatch) {
      const number = parseInt(trackMatch[1])
      const sectorLength = parseInt(trackMatch[2])
      const startSector = parseInt(trackMatch[3])
      const endSector = startSector + sectorLength - 1
      const durationSeconds = sectorLength / 75 // 75 sectors per second for audio CDs

      tracks.push({ number, startSector, endSector, durationSeconds })
      // MusicBrainz DiscID offset, not the raw rip-time LBA — see doc comment above.
      trackOffsets.push(startSector + MSF_LEAD_IN_OFFSET)
      continue
    }

    // Match TOTAL line: "TOTAL  40200 [08:56.00]    (audio only)"
    const totalMatch = line.match(/TOTAL\s+(\d+)\s+\[[\d:.]+\]/)
    if (totalMatch) {
      // Lead-out sector = last track start + last track length
      // Or compute from TOTAL length + first track offset
      if (tracks.length > 0) {
        const lastTrack = tracks[tracks.length - 1]
        leadOutSector = lastTrack.endSector + 1 + MSF_LEAD_IN_OFFSET
      }
    }
  }

  if (tracks.length === 0) {
    return null
  }

  // If we didn't get leadOutSector from TOTAL, compute it
  if (leadOutSector === 0 && tracks.length > 0) {
    leadOutSector = tracks[tracks.length - 1].endSector + 1 + MSF_LEAD_IN_OFFSET
  }

  const totalDurationSeconds = tracks.reduce((sum, t) => sum + t.durationSeconds, 0)

  return {
    trackCount: tracks.length,
    tracks,
    leadOutSector,
    totalDurationSeconds,
    devicePath,
    trackOffsets
  }
}
