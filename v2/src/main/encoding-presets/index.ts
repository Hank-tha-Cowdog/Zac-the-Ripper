import type { MediaInfo } from '../services/ffprobe'
import { getSetting } from '../database/queries/settings'

export interface EncodingContext {
  mediaInfo: MediaInfo
  preserveInterlaced: boolean
  convertSubsToSrt: boolean
}

export function getEncodingArgs(preset: string, context: EncodingContext): string[] {
  switch (preset) {
    case 'ffv1':
      return getFFV1Args(context)
    case 'h264':
      return getH264Args(context)
    case 'hevc':
      return getHEVCArgs(context)
    default:
      throw new Error(`Unknown encoding preset: ${preset}`)
  }
}

function getFFV1Args(context: EncodingContext): string[] {
  const { mediaInfo } = context
  const video = mediaInfo.videoStreams[0]
  const threads = getSetting('encoding.ffv1_threads') || '0'

  const is10bit = video && (video.bitDepth > 8 || video.isHDR)
  const pixFmt = is10bit ? 'yuv420p10le' : 'yuv420p'

  const args = [
    // Video: FFV1 lossless
    '-c:v', 'ffv1',
    '-level', '3',
    '-slices', '24',
    '-slicecrc', '1',
    '-g', '1', // Every frame is a keyframe
    '-pix_fmt', pixFmt,
    '-threads', threads,
    // Audio: FLAC lossless
    '-c:a', 'flac',
    // Subtitles: copy all
    '-c:s', 'copy',
    // Map all streams + preserve all metadata and chapters
    '-map', '0', '-map_metadata', '0', '-map_chapters', '0'
  ]

  // Bug 4 fix: Preserve source color metadata in container for FFV1
  // FFV1 is lossless so pixels are correct, but downstream tools need color tags
  if (video) {
    if (video.colorSpace) args.push('-colorspace', video.colorSpace)
    if (video.colorTransfer) args.push('-color_trc', video.colorTransfer)
    if (video.colorPrimaries) args.push('-color_primaries', video.colorPrimaries)
    if (video.colorRange) args.push('-color_range', video.colorRange)
  }

  return args
}

function getH264Args(context: EncodingContext): string[] {
  const { mediaInfo, preserveInterlaced } = context
  const video = mediaInfo.videoStreams[0]

  const crf = getSetting('encoding.h264_crf') || '18'
  const preset = getSetting('encoding.h264_preset') || 'slow'
  const maxrate = getSetting('encoding.h264_maxrate') || '15M'
  const bufsize = getSetting('encoding.h264_bufsize') || '30M'
  const hwAccel = getSetting('encoding.hw_accel') || 'software'

  const args: string[] = []
  const vfFilters: string[] = []

  // SD color space conversion: rec601 -> rec709 for modern playback compatibility
  // Bug 1 fix: DVDs are always BT.601. When colorSpace is empty/unknown, still convert.
  const isSD = video && video.width <= 720
  const isSDColorConvertNeeded = isSD && video.colorSpace !== 'bt709'

  if (isSDColorConvertNeeded) {
    // Bug 3 fix: Interlaced content needs deinterlacing before colorspace filter
    // to avoid combing artifacts from field-as-frame processing
    if (video?.isInterlaced && !preserveInterlaced) {
      vfFilters.push('yadif=mode=0')
    }

    const iall = video.colorPrimaries === 'bt470bg'
      ? 'bt601-6-625'    // PAL
      : 'bt601-6-525'    // NTSC (default for empty/smpte170m)
    vfFilters.push(`colorspace=all=bt709:iall=${iall}`)
  }

  // Check if UHD needs downscaling to 1080p
  const isUHD = video && (video.width > 1920 || video.height > 1080)
  if (isUHD) {
    // Use software scaling for chroma accuracy (VideoToolbox scaler has chroma position bugs)
    vfFilters.push('scale=1920:-2:flags=lanczos')
    if (video.isHDR) {
      vfFilters.push('colorspace=all=bt709:iall=bt2020ncl')
    }
  }

  // Apply video filters if any
  if (vfFilters.length > 0) {
    args.push('-vf', vfFilters.join(','))
    if (isUHD || isSD) {
      args.push('-sws_flags', 'spline+full_chroma_int+accurate_rnd')
    }
  }

  // Preserve interlaced flags if source is interlaced (no deinterlacing)
  // Bug 3: Skip interlaced flags if we already deinterlaced for colorspace conversion
  const deinterlacedForColor = isSDColorConvertNeeded && video?.isInterlaced && !preserveInterlaced
  if (video?.isInterlaced && !deinterlacedForColor) {
    args.push('-flags', '+ilme+ildct', '-top', '1')
  }

  // Video codec selection based on HW acceleration setting
  switch (hwAccel) {
    case 'videotoolbox':
      // VideoToolbox: NO CRF support. Use -q:v (0-100, higher=better quality)
      // -q:v 65 is roughly equivalent to CRF 18 in perceived quality
      args.push(
        '-c:v', 'h264_videotoolbox',
        '-profile:v', 'high',
        '-q:v', '65',
        '-allow_sw', '1' // Fallback to software if HW encoder is busy
      )
      break

    case 'nvenc':
      args.push(
        '-c:v', 'h264_nvenc',
        '-preset', 'p7', // Slowest/best quality NVENC preset
        '-cq', crf,
        '-profile:v', 'high',
        '-level:v', '5.1'
      )
      break

    case 'qsv':
      args.push(
        '-c:v', 'h264_qsv',
        '-global_quality', crf,
        '-profile:v', 'high',
        '-level', '51'
      )
      break

    case 'vaapi':
      args.push(
        '-c:v', 'h264_vaapi',
        '-qp', crf,
        '-profile:v', '100', // High profile
        '-level', '51'
      )
      break

    default:
      // Software libx264 — highest quality, most tuning options
      args.push(
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', crf,
        '-profile:v', 'high',
        '-level:v', '5.1',
        '-maxrate', maxrate,
        '-bufsize', bufsize,
        '-movflags', '+faststart'
      )
      break
  }

  // Bug 2 fix: HW encoders don't auto-tag output color metadata after colorspace conversion
  if (isSDColorConvertNeeded && hwAccel !== 'software') {
    args.push(
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709'
    )
  }

  // Audio: passthrough (preserve original AC3/DTS/TrueHD)
  args.push('-c:a', 'copy')

  // Subtitles: copy as soft subs (not burned in)
  args.push('-c:s', 'copy')

  // Map all streams + preserve all metadata and chapters
  args.push('-map', '0', '-map_metadata', '0', '-map_chapters', '0')

  return args
}

function getHEVCArgs(context: EncodingContext): string[] {
  const { mediaInfo, preserveInterlaced } = context
  const video = mediaInfo.videoStreams[0]

  const quality = getSetting('encoding.hevc_quality') || '65'
  const hwAccel = getSetting('encoding.hw_accel') || 'videotoolbox'
  const crf = getSetting('encoding.h264_crf') || '18' // Used as CRF fallback for software/nvenc/qsv/vaapi

  const args: string[] = []
  const vfFilters: string[] = []

  // Determine if 10-bit / HDR content
  const is10bit = video && (video.bitDepth > 8 || video.isHDR)
  const profileName = is10bit ? 'main10' : 'main'

  // SD color space conversion: rec601 -> rec709 for modern playback compatibility
  // Bug 1 fix: DVDs are always BT.601. When colorSpace is empty/unknown, still convert.
  const isSD = video && video.width <= 720
  const isSDColorConvertNeeded = isSD && video.colorSpace !== 'bt709'

  if (isSDColorConvertNeeded) {
    // Bug 3 fix: Interlaced content needs deinterlacing before colorspace filter
    if (video?.isInterlaced && !preserveInterlaced) {
      vfFilters.push('yadif=mode=0')
    }

    const iall = video.colorPrimaries === 'bt470bg'
      ? 'bt601-6-625'    // PAL
      : 'bt601-6-525'    // NTSC (default for empty/smpte170m)
    vfFilters.push(`colorspace=all=bt709:iall=${iall}`)
  }

  // Check if UHD needs downscaling to 1080p
  const isUHD = video && (video.width > 1920 || video.height > 1080)
  if (isUHD) {
    vfFilters.push('scale=1920:-2:flags=lanczos')
    if (video.isHDR) {
      vfFilters.push('colorspace=all=bt709:iall=bt2020ncl')
    }
  }

  // Apply video filters if any
  if (vfFilters.length > 0) {
    args.push('-vf', vfFilters.join(','))
    if (isUHD || isSD) {
      args.push('-sws_flags', 'spline+full_chroma_int+accurate_rnd')
    }
  }

  // Preserve interlaced flags if source is interlaced (no deinterlacing)
  // Bug 3: Skip interlaced flags if we already deinterlaced for colorspace conversion
  const deinterlacedForColor = isSDColorConvertNeeded && video?.isInterlaced && !preserveInterlaced
  if (video?.isInterlaced && !deinterlacedForColor) {
    args.push('-flags', '+ilme+ildct', '-top', '1')
  }

  // Video codec selection based on HW acceleration setting
  switch (hwAccel) {
    case 'videotoolbox':
      args.push(
        '-c:v', 'hevc_videotoolbox',
        '-q:v', quality,
        '-tag:v', 'hvc1',
        '-profile:v', profileName,
        '-allow_sw', '1'
      )
      break

    case 'nvenc':
      args.push(
        '-c:v', 'hevc_nvenc',
        '-preset', 'p7',
        '-cq', crf,
        '-profile:v', profileName,
        '-tag:v', 'hvc1'
      )
      break

    case 'qsv':
      args.push(
        '-c:v', 'hevc_qsv',
        '-global_quality', crf,
        '-profile:v', profileName
      )
      break

    case 'vaapi':
      args.push(
        '-c:v', 'hevc_vaapi',
        '-qp', crf,
        '-profile:v', profileName
      )
      break

    default:
      // Software libx265
      args.push(
        '-c:v', 'libx265',
        '-preset', getSetting('encoding.h264_preset') || 'slow',
        '-crf', crf,
        '-profile:v', profileName,
        '-tag:v', 'hvc1'
      )
      // Pass HDR metadata through for 10-bit software encode
      if (is10bit && video) {
        args.push('-x265-params', [
          `colorprim=${video.colorPrimaries || 'bt2020'}`,
          `transfer=${video.colorTransfer || 'smpte2084'}`,
          `colormatrix=${video.colorSpace || 'bt2020nc'}`
        ].join(':'))
      }
      break
  }

  // Bug 2 fix: HW encoders don't auto-tag output color metadata after SD colorspace conversion
  if (isSDColorConvertNeeded && hwAccel !== 'software') {
    args.push(
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709'
    )
  }

  // Bug 5 fix: HW HEVC encoders lose HDR metadata (only libx265 sets it via -x265-params)
  if (hwAccel !== 'software' && is10bit && video) {
    args.push(
      '-color_primaries', video.colorPrimaries || 'bt2020',
      '-color_trc', video.colorTransfer || 'smpte2084',
      '-colorspace', video.colorSpace || 'bt2020nc'
    )
  }

  // Audio: passthrough (preserve original AC3/DTS/TrueHD)
  args.push('-c:a', 'copy')

  // Subtitles: copy as soft subs (not burned in)
  args.push('-c:s', 'copy')

  // Map all streams + preserve all metadata and chapters
  args.push('-map', '0', '-map_metadata', '0', '-map_chapters', '0')

  return args
}
