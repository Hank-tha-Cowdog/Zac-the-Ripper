import type { DiscInfo, TrackInfo } from './disc-detection'

/**
 * Pure parsing of MakeMKV's `--robot info` output (CINFO/TINFO/SINFO lines).
 * Extracted from DiscDetectionService so this logic — previously wrong in
 * ways that silently corrupted every scan (see comments below) — can be
 * unit-tested against realistic fixture lines without needing a working
 * MakeMKV installation or an Electron runtime.
 */

/**
 * Per-scan accumulator for SINFO stream types. MakeMKV's SINFO lines don't
 * repeat the stream's type (Audio/Subtitles/Video) on every attribute — only
 * the attrId=1 line for that stream carries it. Every later attribute
 * (language, codec, ...) for the same stream has to be routed using this
 * remembered type. Keyed by "trackId:streamId". Create one fresh per scan.
 */
export type StreamTypeMap = Map<string, string>

export function parseMakeMKVInfoLine(
  line: string,
  info: Partial<DiscInfo>,
  trackMap: Map<number, TrackInfo>,
  streamTypeMap: StreamTypeMap
): void {
  // CINFO: disc-level info. Attribute IDs are MakeMKV's own
  // AP_ItemAttributeId enum (apdefs.h) — attr 1 is Type, attr 2 is Name,
  // attr 32 is VolumeName. This previously read attr 28 (actually
  // MetadataLanguageCode, e.g. "eng") as a disc-type string — which never
  // contains "Blu-ray", so every disc was typed 'DVD' regardless of what
  // it actually was — and attr 30 (actually TreeInfo, largely internal)
  // as the volume name/disc identity, producing unstable discIds.
  if (line.startsWith('CINFO:')) {
    const match = line.match(/CINFO:(\d+),(\d+),"?([^"]*)"?/)
    if (match) {
      const [, attrId, , value] = match
      switch (attrId) {
        case '1': // Type — e.g. "Blu-ray disc", "DVD disc", "HD DVD disc"
          if (value.includes('Blu-ray') || value.includes('BD')) {
            // MakeMKV doesn't cleanly flag UHD via this field on every
            // version; "Ultra HD"/"UHD" substrings are the known signal
            // when present. Falls back to 'BD' otherwise (uncertain on
            // versions that never include the substring at all).
            info.discType = /ultra\s*hd|uhd/i.test(value) ? 'UHD_BD' : 'BD'
          } else {
            info.discType = 'DVD'
          }
          break
        case '2': // Name — disc/title name as MakeMKV reads it
          info.title = value
          break
        case '32': // VolumeName — the actual stable disc-identity signal
          info.discId = value
          break
      }
    }
  }

  // TINFO: track-level info
  if (line.startsWith('TINFO:')) {
    const match = line.match(/TINFO:(\d+),(\d+),(\d+),"?([^"]*)"?/)
    if (match) {
      const [, trackIdStr, attrId, , value] = match
      const trackId = parseInt(trackIdStr)

      if (!trackMap.has(trackId)) {
        trackMap.set(trackId, {
          id: trackId,
          title: `Title ${trackId}`,
          duration: '0:00:00',
          durationSeconds: 0,
          size: '0 MB',
          sizeBytes: 0,
          chapters: 0,
          resolution: '',
          framerate: '',
          isInterlaced: false,
          audioTracks: [],
          subtitleTracks: []
        })
      }

      const track = trackMap.get(trackId)!
      switch (attrId) {
        case '2': track.title = value; break
        case '9':
          track.duration = value
          track.durationSeconds = parseDuration(value)
          break
        case '10':
          track.size = value
          track.sizeBytes = parseSize(value)
          break
        case '8': track.chapters = parseInt(value) || 0; break
        case '19':
          track.resolution = value
          track.isInterlaced = value.includes('i')
          break
        case '21': track.framerate = value; break
      }
    }
  }

  // SINFO: stream-level info (audio/subtitle tracks within a title).
  // Format is SINFO:trackId,streamId,attrId,attrCode,"value" — the same
  // shape as TINFO with an extra streamId field. The 4th field is an
  // attribute *format* code (matches TINFO's discarded 3rd field), not a
  // stream type — treating it as one meant every stream (video included)
  // fell through to parseAudioStream, and parseSubtitleStream was
  // unreachable. The stream's actual type ("Audio"/"Subtitles"/"Video")
  // only appears once, on that stream's own attrId=1 line; every other
  // attribute for the same stream has to be routed using the remembered
  // type from streamTypeMap.
  if (line.startsWith('SINFO:')) {
    const match = line.match(/SINFO:(\d+),(\d+),(\d+),(\d+),"?([^"]*)"?/)
    if (match) {
      const [, trackIdStr, streamIdStr, attrId, , value] = match
      const trackId = parseInt(trackIdStr)
      const streamId = parseInt(streamIdStr)
      const track = trackMap.get(trackId)
      if (!track) return

      const streamKey = `${trackId}:${streamId}`

      if (attrId === '1') {
        // This line declares the stream's type — remember it and don't
        // treat "Audio"/"Subtitles"/"Video" itself as a codec/language value.
        streamTypeMap.set(streamKey, value)
        return
      }

      const streamType = streamTypeMap.get(streamKey)
      if (streamType === 'Audio') {
        parseAudioStream(track, streamId, attrId, value)
      } else if (streamType === 'Subtitles') {
        parseSubtitleStream(track, streamId, attrId, value)
      }
      // Video-stream attributes (streamType === 'Video') and any stream
      // whose type line hasn't arrived yet are intentionally ignored here
      // — video-level detail comes from TINFO, not SINFO.
    }
  }
}

// Attribute IDs verified against real `makemkvcon --robot info` output (a
// registered copy ripping a real DVD) — e.g. for one AC3 5.1 English track:
//   SINFO:0,1,2,0,"Surround 5.1"     attr 2  = Name (channel-layout label, not a codec)
//   SINFO:0,1,3,0,"eng"              attr 3  = Lang Code
//   SINFO:0,1,4,0,"English"          attr 4  = Lang Name
//   SINFO:0,1,5,0,"A_AC3"            attr 5  = Codec Id
//   SINFO:0,1,6,0,"DD"               attr 6  = Codec Short
//   SINFO:0,1,7,0,"Dolby Digital"    attr 7  = Codec Long
//   SINFO:0,1,13,0,"384 Kb/s"        attr 13 = Bitrate
//   SINFO:0,1,14,0,"6"               attr 14 = Channel count
// The previous mapping (2→codec, 3→language, 4→channels, 5→bitrate) was
// never checked against real output — every field but language was reading
// the wrong attribute (codec held the channel-layout name, channels held
// the language name, bitrate held the codec id).
function parseAudioStream(track: TrackInfo, streamId: number, attrId: string, value: string): void {
  let audio = track.audioTracks.find(a => a.id === streamId)
  if (!audio) {
    audio = { id: streamId, codec: '', language: '', channels: '', bitrate: '' }
    track.audioTracks.push(audio)
  }
  switch (attrId) {
    case '3': audio.language = value; break
    // 5/6/7 arrive in that order (Id, then Short, then Long) — prefer the
    // most human-readable one seen so far without discarding an earlier
    // value if a later attribute happens to be empty.
    case '5': if (!audio.codec) audio.codec = value; break
    case '6': if (value) audio.codec = value; break
    case '7': if (value) audio.codec = value; break
    case '13': audio.bitrate = value; break
    case '14': audio.channels = value; break
  }
}

function parseSubtitleStream(track: TrackInfo, streamId: number, attrId: string, value: string): void {
  let sub = track.subtitleTracks.find(s => s.id === streamId)
  if (!sub) {
    sub = { id: streamId, type: 'unknown', language: '', codec: '' }
    track.subtitleTracks.push(sub)
  }
  switch (attrId) {
    case '3': sub.language = value; break
    case '5': {
      // Codec Id (e.g. "S_VOBSUB", "S_CC608/DVD") — the only attribute
      // MakeMKV reliably emits for a subtitle stream's format. Attr 2
      // ("Name") is never emitted for subtitle streams at all (verified
      // against real output — subtitle SINFO jumps straight from attr 1
      // to attr 3), so the previous code's `case '2'` check never matched
      // anything and every subtitle stream's type/codec stayed at its
      // default ('unknown'/''). Real values are upper-cased with an
      // underscore prefix ("S_VOBSUB", not "VobSub"), which the previous
      // mixed-case substring check would also have missed.
      sub.codec = value
      const upper = value.toUpperCase()
      if (upper.includes('VOBSUB')) sub.type = 'vobsub'
      else if (upper.includes('PGS')) sub.type = 'pgs'
      else if (upper.includes('SRT') || upper.includes('TEXT')) sub.type = 'srt'
      else if (upper.includes('CC608')) sub.type = 'cc608'
      else if (upper.includes('CC708')) sub.type = 'cc708'
      break
    }
  }
}

export function parseDuration(str: string): number {
  const parts = str.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

export function parseSize(str: string): number {
  const match = str.match(/([\d.]+)\s*(GB|MB|KB)/)
  if (!match) return 0
  const num = parseFloat(match[1])
  switch (match[2]) {
    case 'GB': return num * 1073741824
    case 'MB': return num * 1048576
    case 'KB': return num * 1024
    default: return num
  }
}
