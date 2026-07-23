import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getEncodingArgs, type EncodingContext } from './index'
import type { MediaInfo, VideoStreamInfo } from '../services/ffprobe'

const settingsStore: Record<string, string> = {}

vi.mock('../database/queries/settings', () => ({
  getSetting: (key: string) => settingsStore[key]
}))

vi.mock('../util/ffmpeg-capabilities', () => ({
  hasZscaleSupport: vi.fn()
}))

import { hasZscaleSupport } from '../util/ffmpeg-capabilities'
const mockedHasZscale = vi.mocked(hasZscaleSupport)

function video(overrides: Partial<VideoStreamInfo> = {}): VideoStreamInfo {
  return {
    index: 0,
    codec: 'mpeg2video',
    codecLongName: '',
    width: 720,
    height: 480,
    displayAspectRatio: '16:9',
    sampleAspectRatio: '1:1',
    framerate: '29.970',
    framerateNum: 30000,
    framerateDen: 1001,
    isInterlaced: false,
    fieldOrder: 'progressive',
    bitDepth: 8,
    pixelFormat: 'yuv420p',
    colorSpace: '',
    colorTransfer: '',
    colorPrimaries: '',
    colorRange: '',
    isHDR: false,
    profile: '',
    level: '',
    ...overrides
  } as VideoStreamInfo
}

function mediaInfo(v: VideoStreamInfo): MediaInfo {
  return {
    format: 'mpeg',
    duration: 5400,
    size: 0,
    bitrate: 0,
    videoStreams: [v],
    audioStreams: [],
    subtitleStreams: []
  }
}

function ctx(v: VideoStreamInfo, overrides: Partial<EncodingContext> = {}): EncodingContext {
  return {
    mediaInfo: mediaInfo(v),
    preserveInterlaced: false,
    convertSubsToSrt: false,
    ffmpegPath: '/usr/bin/ffmpeg',
    ...overrides
  }
}

function vfArg(args: string[]): string | undefined {
  const i = args.indexOf('-vf')
  return i >= 0 ? args[i + 1] : undefined
}

beforeEach(() => {
  for (const k of Object.keys(settingsStore)) delete settingsStore[k]
  mockedHasZscale.mockReset()
  mockedHasZscale.mockReturnValue(false)
})

describe('FFV1 preset — archival integrity', () => {
  it('copies audio instead of re-encoding to FLAC (preserves TrueHD/Atmos/DTS:X)', () => {
    const args = getEncodingArgs('ffv1', ctx(video()))
    const audioCodecIndex = args.indexOf('-c:a')
    expect(args[audioCodecIndex + 1]).toBe('copy')
    expect(args).not.toContain('flac')
  })

  it('uses the source pixel format instead of forcing yuv420p/yuv420p10le', () => {
    const args = getEncodingArgs('ffv1', ctx(video({ pixelFormat: 'yuv422p10le' })))
    const pixFmtIndex = args.indexOf('-pix_fmt')
    expect(args[pixFmtIndex + 1]).toBe('yuv422p10le')
  })

  it('falls back to yuv420p only when the source pixel format is unknown', () => {
    const args = getEncodingArgs('ffv1', ctx(video({ pixelFormat: '' })))
    const pixFmtIndex = args.indexOf('-pix_fmt')
    expect(args[pixFmtIndex + 1]).toBe('yuv420p')
  })

  it('sets the range coder and context model for preservation-grade FFV1', () => {
    const args = getEncodingArgs('ffv1', ctx(video()))
    expect(args).toEqual(expect.arrayContaining(['-coder', '1', '-context', '1']))
  })

  it('tags color metadata via setparams filter, not broken output options', () => {
    const args = getEncodingArgs('ffv1', ctx(video({
      colorPrimaries: 'smpte170m', colorTransfer: 'smpte170m', colorSpace: 'smpte170m', colorRange: 'tv'
    })))
    expect(args).not.toContain('-color_primaries')
    const vf = vfArg(args)
    expect(vf).toContain('setparams=')
    expect(vf).toContain('color_primaries=smpte170m')
    expect(vf).toContain('range=tv')
  })

  it('emits no setparams filter when the source has no color tags at all', () => {
    const args = getEncodingArgs('ffv1', ctx(video()))
    expect(vfArg(args)).toBeUndefined()
  })
})

describe('H.264 preset — PAL/deinterlace/HDR correctness', () => {
  it('detects untagged PAL DVDs via height, not just the bt470bg tag', () => {
    // Untagged PAL: 720x576, 25fps, no color tags — the common real-world case.
    const args = getEncodingArgs('h264', ctx(video({ width: 720, height: 576, framerate: '25', colorPrimaries: '' })))
    const vf = vfArg(args)!
    expect(vf).toContain('iall=bt601-6-625') // PAL matrix, not NTSC's 525
  })

  it('still detects PAL via the bt470bg tag when present', () => {
    const args = getEncodingArgs('h264', ctx(video({ width: 720, height: 480, framerate: '25', colorPrimaries: 'bt470bg' })))
    expect(vfArg(args)).toContain('iall=bt601-6-625')
  })

  it('uses the NTSC matrix for untagged 720x480/29.97fps sources', () => {
    const args = getEncodingArgs('h264', ctx(video({ width: 720, height: 480, framerate: '29.970' })))
    expect(vfArg(args)).toContain('iall=bt601-6-525')
  })

  it('deinterlaces interlaced HD content — previously only SD content got deinterlaced', () => {
    const args = getEncodingArgs('h264', ctx(video({
      width: 1920, height: 1080, isInterlaced: true, colorSpace: 'bt709'
    })))
    expect(vfArg(args)).toContain('yadif=mode=0')
    // Deinterlaced, so the legacy interlace-preserving flags must not also apply.
    expect(args).not.toContain('+ilme+ildct')
  })

  it('preserves interlace flags instead of deinterlacing when preserveInterlaced is set', () => {
    const args = getEncodingArgs('h264', ctx(
      video({ width: 1920, height: 1080, isInterlaced: true, colorSpace: 'bt709' }),
      { preserveInterlaced: true }
    ))
    expect(vfArg(args) || '').not.toContain('yadif')
    expect(args).toEqual(expect.arrayContaining(['-flags', '+ilme+ildct']))
  })

  it('uses the real zscale+tonemap chain when zscale is available', () => {
    mockedHasZscale.mockReturnValue(true)
    settingsStore['encoding.preserve_resolution'] = 'false'
    const args = getEncodingArgs('h264', ctx(video({
      width: 3840, height: 2160, isHDR: true, colorTransfer: 'smpte2084', colorPrimaries: 'bt2020', colorSpace: 'bt2020nc'
    })))
    const vf = vfArg(args)!
    expect(vf).toContain('zscale=t=linear')
    expect(vf).toContain('tonemap=')
    expect(vf).toContain('format=yuv420p')
  })

  it('falls back gracefully (no invalid filter chain) when zscale is unavailable — the verified-broken case', () => {
    mockedHasZscale.mockReturnValue(false)
    settingsStore['encoding.preserve_resolution'] = 'false'
    const args = getEncodingArgs('h264', ctx(video({
      width: 3840, height: 2160, isHDR: true, colorTransfer: 'smpte2084', colorPrimaries: 'bt2020', colorSpace: 'bt2020nc'
    })))
    const vf = vfArg(args)!
    // Must NOT contain the invalid chain that was verified to fail 100% of
    // the time (colorspace filter can't process PQ input at all).
    expect(vf).not.toContain('iall=bt2020ncl')
    expect(vf).not.toContain('zscale')
    // Still downscales, and tags the source's real HDR properties rather
    // than mislabeling PQ content as BT.709.
    expect(vf).toContain('scale=1920:-2')
    expect(vf).toContain('color_trc=smpte2084')
  })

  it('forces 8-bit pix_fmt for software libx264 on 10-bit input (hard error otherwise)', () => {
    settingsStore['encoding.hw_accel'] = 'software'
    const args = getEncodingArgs('h264', ctx(video({ bitDepth: 10, pixelFormat: 'yuv420p10le' })))
    const pixFmtIndex = args.indexOf('-pix_fmt')
    expect(pixFmtIndex).toBeGreaterThan(-1)
    expect(args[pixFmtIndex + 1]).toBe('yuv420p')
  })

  it('tags SD BT.601->BT.709 conversion via setparams, not broken output options', () => {
    const args = getEncodingArgs('h264', ctx(video()))
    expect(args).not.toContain('-color_primaries')
    expect(vfArg(args)).toContain('setparams=color_primaries=bt709')
  })
})

describe('HEVC preset — HDR passthrough and bit-depth correctness', () => {
  it('preserves HDR when downscaling UHD instead of attempting a lossy tonemap', () => {
    settingsStore['encoding.preserve_resolution'] = 'false'
    const args = getEncodingArgs('hevc', ctx(video({
      width: 3840, height: 2160, isHDR: true, bitDepth: 10, pixelFormat: 'yuv420p10le',
      colorTransfer: 'smpte2084', colorPrimaries: 'bt2020', colorSpace: 'bt2020nc'
    })))
    const vf = vfArg(args)!
    expect(vf).toContain('scale=1920:-2')
    expect(vf).not.toContain('tonemap')
    expect(vf).not.toContain('zscale')
    expect(vf).toContain('color_trc=smpte2084') // HDR tags preserved, not converted to bt709
  })

  it('uses main10 profile for a 10-bit source correctly detected via pix_fmt', () => {
    // bitDepth here simulates the now-fixed ffprobe detection (would have
    // been 8 before, since bits_per_raw_sample is often absent for 10-bit HEVC).
    const args = getEncodingArgs('hevc', ctx(video({ bitDepth: 10, pixelFormat: 'yuv420p10le' })))
    const profileIndex = args.indexOf('-profile:v')
    expect(args[profileIndex + 1]).toBe('main10')
  })

  it('does not mislabel 10-bit SDR content as HDR/BT.2020 in the software x265 path', () => {
    settingsStore['encoding.hw_accel'] = 'software'
    const args = getEncodingArgs('hevc', ctx(video({ bitDepth: 10, pixelFormat: 'yuv420p10le', isHDR: false })))
    expect(args).not.toContain('-x265-params')
  })

  it('applies BT.2020/PQ x265-params only for genuinely HDR software encodes', () => {
    settingsStore['encoding.hw_accel'] = 'software'
    const args = getEncodingArgs('hevc', ctx(video({
      bitDepth: 10, pixelFormat: 'yuv420p10le', isHDR: true, colorTransfer: 'smpte2084'
    })))
    const paramsIndex = args.indexOf('-x265-params')
    expect(paramsIndex).toBeGreaterThan(-1)
    expect(args[paramsIndex + 1]).toContain('transfer=smpte2084')
  })
})

describe('cross-preset sanity', () => {
  it('throws on an unknown preset', () => {
    expect(() => getEncodingArgs('divx', ctx(video()))).toThrow(/Unknown encoding preset/)
  })

  it('every preset maps all streams and preserves metadata/chapters', () => {
    for (const preset of ['ffv1', 'h264', 'hevc']) {
      const args = getEncodingArgs(preset, ctx(video()))
      expect(args).toEqual(expect.arrayContaining(['-map', '0', '-map_metadata', '0', '-map_chapters', '0']))
    }
  })
})
