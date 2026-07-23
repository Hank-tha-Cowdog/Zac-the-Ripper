export interface FlacTagContext {
  wavPath: string
  outputPath: string
  coverArtPath: string | null
  compressionLevel: string
  trackTitle: string
  trackArtist: string
  trackNumber: number
  totalTracks: number
  album: string
  albumArtist: string
  year: string
  discNumber: number
  totalDiscs: number
  mbReleaseId?: string | null
  albumArtistId?: string | null
  recordingId?: string | null
  discId?: string | null
  genre?: string | null
  isVariousArtists?: boolean
}

/**
 * Builds the ffmpeg argument list for one WAV → tagged FLAC encode.
 *
 * The MUSICBRAINZ_(ALBUMID|ALBUMARTISTID|TRACKID|DISCID)/GENRE/COMPILATION
 * Vorbis comment field names are verified against Picard's official tag mapping
 * (picard-docs.musicbrainz.org/en/latest/appendices/tag_mapping.html) so
 * Navidrome and other Vorbis-comment-aware players resolve them the same
 * way a Picard-tagged library would.
 */
export function buildFlacEncodeArgs(ctx: FlacTagContext): string[] {
  const args: string[] = ['-y', '-i', ctx.wavPath]

  if (ctx.coverArtPath) {
    args.push('-i', ctx.coverArtPath)
    args.push('-map', '0:a', '-map', '1:v')
    args.push('-c:v', 'copy', '-disposition:v', 'attached_pic')
  }

  args.push('-c:a', 'flac')
  args.push('-compression_level', ctx.compressionLevel)

  args.push('-metadata', `title=${ctx.trackTitle}`)
  args.push('-metadata', `artist=${ctx.trackArtist}`)
  args.push('-metadata', `album=${ctx.album}`)
  args.push('-metadata', `albumartist=${ctx.albumArtist}`)
  args.push('-metadata', `track=${ctx.trackNumber}/${ctx.totalTracks}`)
  args.push('-metadata', `date=${ctx.year}`)
  if (ctx.totalDiscs > 1) {
    args.push('-metadata', `disc=${ctx.discNumber}/${ctx.totalDiscs}`)
  }

  if (ctx.mbReleaseId) args.push('-metadata', `MUSICBRAINZ_ALBUMID=${ctx.mbReleaseId}`)
  if (ctx.albumArtistId) args.push('-metadata', `MUSICBRAINZ_ALBUMARTISTID=${ctx.albumArtistId}`)
  if (ctx.recordingId) args.push('-metadata', `MUSICBRAINZ_TRACKID=${ctx.recordingId}`)
  if (ctx.discId) args.push('-metadata', `MUSICBRAINZ_DISCID=${ctx.discId}`)
  if (ctx.genre) args.push('-metadata', `GENRE=${ctx.genre}`)
  if (ctx.isVariousArtists) args.push('-metadata', 'COMPILATION=1')

  args.push(ctx.outputPath)
  return args
}
