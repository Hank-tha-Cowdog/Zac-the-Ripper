/**
 * Parses ffprobe's `-of csv=p=0` output for a `-show_entries
 * stream=codec_type,codec_name` query, and reports whether any stream is a
 * genuinely playable video stream (not just video-*typed*).
 *
 * IMPORTANT: ffprobe's csv field order follows its own internal schema
 * (codec_name, then codec_type) regardless of the order fields are listed in
 * -show_entries — verified directly against real DVD disc data. Some DVD
 * bonus-content VTSes (menu-heavy/interactive material) have a stream
 * ffprobe types as "video" but reports codec_name=unknown for; treating
 * codec_type alone as sufficient let these through a pre-flight check,
 * wasting a full concat+copy rip attempt that then failed partway through.
 */
export function hasRecognizedVideoStream(csvOutput: string): boolean {
  const lines = csvOutput.trim().split('\n').filter(Boolean)
  return lines.some(line => {
    const [codecName, codecType] = line.split(',')
    return codecType === 'video' && !!codecName && codecName !== 'unknown'
  })
}
