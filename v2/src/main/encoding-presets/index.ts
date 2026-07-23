import type { MediaInfo } from '../services/ffprobe'
import { getSetting } from '../database/queries/settings'
import { hasZscaleSupport } from '../util/ffmpeg-capabilities'

export interface EncodingContext {
  mediaInfo: MediaInfo
  preserveInterlaced: boolean
  convertSubsToSrt: boolean
  /** Needed to probe HDR-tonemap filter (zscale) availability for the H.264
   * preset's UHD+HDR downscale path. Optional so existing call sites don't
   * break; when omitted, tonemap support is assumed unavailable (the safer
   * default — falls back to the non-crashing path). */
  ffmpegPath?: string
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

  // FFV1 natively supports any pixel format the source already uses (4:2:0,
  // 4:2:2, 4:4:4, any bit depth) — forcing yuv420p/yuv420p10le here silently
  // chroma-subsampled any non-4:2:0 source and truncated any bit depth FFV1
  // itself has no trouble carrying losslessly. For a preset whose entire
  // purpose is bit-for-bit preservation, that's not archival.
  const pixFmt = video?.pixelFormat || 'yuv420p'

  const args = [
    // Video: FFV1 lossless
    '-c:v', 'ffv1',
    '-level', '3',
    '-slices', '24',
    '-slicecrc', '1',
    '-g', '1', // Every frame is a keyframe
    '-pix_fmt', pixFmt,
    '-threads', threads,
    // range coder + context model 1: standard preservation-grade FFV1
    // settings (matches Library of Congress / CELLAR FFV1 guidance) — better
    // compression than the default Golomb-Rice coder for 8-bit sources.
    '-coder', '1',
    '-context', '1',
    // Audio: bitstream copy, not FLAC re-encode. FLAC can only represent
    // lossless PCM-equivalent audio — re-encoding through it would decode
    // (lossy for AC3/DTS) and permanently discard TrueHD/DTS-HD MA's actual
    // lossless bitstream and, critically, any Atmos/DTS:X object-based
    // spatial metadata, which has no representation in FLAC/PCM at all.
    '-c:a', 'copy',
    // Subtitles: copy all
    '-c:s', 'copy',
    // Map all streams + preserve all metadata and chapters
    '-map', '0', '-map_metadata', '0', '-map_chapters', '0'
  ]

  // Preserve source color metadata via the setparams filter, not output
  // options — verified on ffmpeg 8 that -color_primaries/-color_trc/
  // -colorspace as *output* options are silently dropped from the encoded
  // bitstream (only -color_range sticks); setparams actually stamps the
  // frame-level props the encoder reads from.
  if (video) {
    const setparams = buildSetparamsFilter(video)
    if (setparams) args.push('-vf', setparams)
  }

  return args
}

/**
 * Builds a setparams filter string tagging color primaries/transfer/space/
 * range from source metadata, for presets that don't otherwise touch -vf.
 * Only includes fields that are actually known — an empty/unknown source
 * field is left untagged rather than guessing. Verified against ffmpeg 8
 * (`-h filter=setparams`) that all four option names and value spellings
 * used here (including "tv"/"pc" for range, matching ffprobe's own
 * color_range values) are valid.
 */
function buildSetparamsFilter(video: { colorPrimaries?: string; colorTransfer?: string; colorSpace?: string; colorRange?: string }): string | null {
  const parts: string[] = []
  if (video.colorPrimaries) parts.push(`color_primaries=${video.colorPrimaries}`)
  if (video.colorTransfer) parts.push(`color_trc=${video.colorTransfer}`)
  if (video.colorSpace) parts.push(`colorspace=${video.colorSpace}`)
  if (video.colorRange) parts.push(`range=${video.colorRange}`)
  return parts.length > 0 ? `setparams=${parts.join(':')}` : null
}

function getH264Args(context: EncodingContext): string[] {
  const { mediaInfo, preserveInterlaced, ffmpegPath } = context
  const video = mediaInfo.videoStreams[0]

  const crf = getSetting('encoding.h264_crf') || '18'
  const preset = getSetting('encoding.h264_preset') || 'slow'
  const maxrate = getSetting('encoding.h264_maxrate') || '15M'
  const bufsize = getSetting('encoding.h264_bufsize') || '30M'
  const hwAccel = getSetting('encoding.hw_accel') || 'videotoolbox'
  const vtQuality = getSetting('encoding.h264_vt_quality') || '65'
  const preserveResolution = getSetting('encoding.preserve_resolution') !== 'false'

  const args: string[] = []
  const vfFilters: string[] = []

  const isSD = video && video.width <= 720
  // PAL detection: bt470bg color-primaries tag is reliable when present, but
  // untagged PAL DVDs (the common case) carry no color tags at all — height
  // (576 for PAL) or 25fps are the fallback signals for those.
  const isPAL = !!video && (
    video.colorPrimaries === 'bt470bg' ||
    video.height >= 576 ||
    Math.abs(parseFloat(video.framerate || '0') - 25) < 0.1
  )
  const isSDColorConvertNeeded = isSD && video.colorSpace !== 'bt709'
  const isUHD = video && (video.width > 1920 || video.height > 1080)
  const needsTonemap = !!(isUHD && !preserveResolution && video?.isHDR)

  // Deinterlacing: previously only applied inside the SD-color-conversion
  // branch below, so interlaced HD content (e.g. 1080i broadcasts/concerts)
  // and bt709-tagged SD sources were never deinterlaced even with
  // preserveInterlaced=false. Hoisted out so it applies whenever the source
  // is actually interlaced, regardless of which (if any) color-conversion
  // branch runs.
  const shouldDeinterlace = !!(video?.isInterlaced && !preserveInterlaced)
  if (shouldDeinterlace) {
    vfFilters.push('yadif=mode=0')
  }

  if (isSDColorConvertNeeded) {
    const iall = isPAL ? 'bt601-6-625' : 'bt601-6-525'
    vfFilters.push(`colorspace=all=bt709:iall=${iall}`)
    // Tag the actual output color properties via the setparams filter, not
    // output options — verified on ffmpeg 8 that -color_primaries/-color_trc/
    // -colorspace as *output* options are silently dropped from the encoded
    // bitstream regardless of encoder (only -color_range survives); setparams
    // stamps the frame-level props the encoder actually reads from, so it
    // works uniformly whether hwAccel is a hardware encoder or software.
    vfFilters.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv')
  } else if (needsTonemap) {
    vfFilters.push('scale=1920:-2:flags=lanczos')
    if (ffmpegPath && hasZscaleSupport(ffmpegPath)) {
      // Proper HDR (PQ/BT.2020) -> SDR (BT.709) tonemap: convert to linear
      // light, apply the hable tonemap operator, convert back to BT.709/tv.
      // Verified this exact chain shape against real ffmpeg output — the
      // three-stage zscale/tonemap/zscale dance is required because tonemap
      // itself only operates correctly on linear-light input.
      vfFilters.push('zscale=t=linear:npl=100,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:p=bt709:r=tv,format=yuv420p')
    }
    // No zscale in this ffmpeg build (common on stock Homebrew ffmpeg,
    // verified): the colorspace filter can't process PQ/HLG input at all
    // ("Conversion failed!" — confirmed), so there is no correct fallback
    // filter chain. Downscale only; the setparams call below tags the
    // source's *actual* HDR properties rather than mislabeling PQ content
    // as BT.709, which would look uniformly washed out on every player.
    // Correctly-tagged HDR at least displays right on HDR-capable playback.
  } else if (isUHD && !preserveResolution) {
    vfFilters.push('scale=1920:-2:flags=lanczos')
  }

  // Tag UHD/HDR output (whether downscaled-with-tonemap, downscaled-without,
  // or kept at source resolution) with the correct color properties.
  if (isUHD && video) {
    const hdrTonemapSucceeded = needsTonemap && !!ffmpegPath && hasZscaleSupport(ffmpegPath)
    if (hdrTonemapSucceeded) {
      vfFilters.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv')
    } else {
      const setparams = buildSetparamsFilter(video)
      if (setparams) vfFilters.push(setparams)
    }
  }

  // VAAPI encoding requires frames uploaded to a hardware surface — without
  // this the encoder has nothing to encode from (part of why VAAPI failed
  // 100% of the time previously; the other part is -init_hw_device below).
  // NOTE: not verifiable on this machine (VAAPI is Linux-only, no such
  // hardware available here) — implemented per documented ffmpeg VAAPI
  // usage, not directly tested against real VAAPI hardware.
  if (hwAccel === 'vaapi') {
    vfFilters.push('format=nv12,hwupload')
  }

  if (vfFilters.length > 0) {
    args.push('-vf', vfFilters.join(','))
    if (isUHD || isSD) {
      args.push('-sws_flags', 'spline+full_chroma_int+accurate_rnd')
    }
  }

  // Preserve interlaced flags only when NOT deinterlacing (preserveInterlaced=true).
  // Only libx264 actually honors these flags — hardware encoders silently
  // ignore them and encode woven fields as progressive regardless; that's a
  // pre-existing limitation of this preset's hw paths, not something this
  // fix changes.
  if (video?.isInterlaced && !shouldDeinterlace) {
    args.push('-flags', '+ilme+ildct', '-top', '1')
  }

  // Video codec selection based on HW acceleration setting
  switch (hwAccel) {
    case 'videotoolbox':
      // VideoToolbox: NO CRF support. Use -q:v (0-100, higher=better quality)
      // 65 is roughly equivalent to CRF 18 in perceived quality
      args.push(
        '-c:v', 'h264_videotoolbox',
        '-profile:v', 'high',
        '-q:v', vtQuality,
        '-allow_sw', '1' // Fallback to software if HW encoder is busy
      )
      break

    case 'nvenc':
      args.push(
        '-c:v', 'h264_nvenc',
        '-preset', 'p7', // Slowest/best quality NVENC preset
        '-rc', 'vbr', '-b:v', '0', // required for -cq to actually govern quality in VBR mode
        '-cq', crf,
        '-profile:v', 'high',
        '-level:v', '5.1'
      )
      break

    case 'qsv':
      args.push(
        '-c:v', 'h264_qsv',
        '-global_quality', crf,
        '-b:v', '0',
        '-profile:v', 'high',
        '-level', '51'
      )
      break

    case 'vaapi':
      args.push(
        '-init_hw_device', 'vaapi=va:/dev/dri/renderD128',
        '-filter_hw_device', 'va',
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
      // libx264 High Profile hard-errors on 10-bit input (verified: exit
      // 234) — this preset targets maximum device compatibility, so force
      // 8-bit rather than switching to the poorly-supported High10 profile.
      // A no-op when the tonemap chain above already forced yuv420p.
      if (video && video.bitDepth > 8) {
        args.push('-pix_fmt', 'yuv420p')
      }
      break
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
  const preserveResolution = getSetting('encoding.preserve_resolution') !== 'false'

  const args: string[] = []
  const vfFilters: string[] = []

  // Determine if 10-bit / HDR content. bitDepth now correctly derives from
  // pix_fmt when ffprobe omits bits_per_raw_sample (see detectBitDepth) —
  // previously this silently misread 10-bit HEVC sources as 8-bit.
  const is10bit = video && (video.bitDepth > 8 || video.isHDR)
  const profileName = is10bit ? 'main10' : 'main'

  const isSD = video && video.width <= 720
  // PAL detection: bt470bg tag is reliable when present, but untagged PAL
  // DVDs (the common case) carry no color tags at all.
  const isPAL = !!video && (
    video.colorPrimaries === 'bt470bg' ||
    video.height >= 576 ||
    Math.abs(parseFloat(video.framerate || '0') - 25) < 0.1
  )
  const isSDColorConvertNeeded = isSD && video.colorSpace !== 'bt709'
  const isUHD = video && (video.width > 1920 || video.height > 1080)

  // Deinterlacing: hoisted out of the SD-only branch (see getH264Args for
  // the full rationale) so interlaced HD content gets deinterlaced too.
  const shouldDeinterlace = !!(video?.isInterlaced && !preserveInterlaced)
  if (shouldDeinterlace) {
    vfFilters.push('yadif=mode=0')
  }

  if (isSDColorConvertNeeded) {
    const iall = isPAL ? 'bt601-6-625' : 'bt601-6-525'
    vfFilters.push(`colorspace=all=bt709:iall=${iall}`)
    vfFilters.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv')
  } else if (isUHD && !preserveResolution) {
    // Unlike the H.264 preset (chosen specifically for maximum device
    // compatibility, where HDR content genuinely needs SDR tonemapping),
    // HEVC already advertises HDR passthrough as a feature — downscaling
    // HDR content here keeps it as HDR rather than attempting a lossy
    // tonemap. This also sidesteps the tonemap filter chain's dependency on
    // zscale, which isn't available in every ffmpeg build (verified absent
    // on stock Homebrew ffmpeg 8.0.1) and would otherwise need the same
    // graceful-fallback handling as the H.264 preset.
    vfFilters.push('scale=1920:-2:flags=lanczos')
    if (video?.isHDR) {
      const setparams = buildSetparamsFilter(video)
      if (setparams) vfFilters.push(setparams)
    }
  } else if (isUHD && preserveResolution && video?.isHDR && hwAccel !== 'software') {
    // HW HEVC encoders (other than libx265, which sets HDR metadata via
    // -x265-params below) need it applied via setparams instead so it
    // survives when keeping UHD/HDR at source resolution. Must land in the
    // same -vf as any deinterlace filter above, not a second -vf call
    // (ffmpeg only honors the last one, silently dropping the first).
    const setparams = buildSetparamsFilter(video)
    if (setparams) vfFilters.push(setparams)
  }

  if (vfFilters.length > 0) {
    args.push('-vf', vfFilters.join(','))
    if (isUHD || isSD) {
      args.push('-sws_flags', 'spline+full_chroma_int+accurate_rnd')
    }
  }

  // Preserve interlaced flags only when NOT deinterlacing.
  if (video?.isInterlaced && !shouldDeinterlace) {
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
        '-rc', 'vbr', '-b:v', '0', // required for -cq to actually govern quality in VBR mode
        '-cq', crf,
        '-profile:v', profileName,
        '-tag:v', 'hvc1'
      )
      break

    case 'qsv':
      args.push(
        '-c:v', 'hevc_qsv',
        '-global_quality', crf,
        '-b:v', '0',
        '-profile:v', profileName
      )
      break

    case 'vaapi':
      args.push(
        '-init_hw_device', 'vaapi=va:/dev/dri/renderD128',
        '-filter_hw_device', 'va',
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
      // Pass HDR metadata through for actually-HDR software encodes only —
      // previously gated on is10bit alone, which also covers plain 10-bit
      // SDR sources and mislabeled them as BT.2020/PQ (dark/oversaturated
      // playback) even though they were never HDR.
      if (video?.isHDR) {
        args.push('-x265-params', [
          `colorprim=${video.colorPrimaries || 'bt2020'}`,
          `transfer=${video.colorTransfer || 'smpte2084'}`,
          `colormatrix=${video.colorSpace || 'bt2020nc'}`
        ].join(':'))
      }
      break
  }

  // Audio: passthrough (preserve original AC3/DTS/TrueHD)
  args.push('-c:a', 'copy')

  // Subtitles: copy as soft subs (not burned in)
  args.push('-c:s', 'copy')

  // Map all streams + preserve all metadata and chapters
  args.push('-map', '0', '-map_metadata', '0', '-map_chapters', '0')

  return args
}
