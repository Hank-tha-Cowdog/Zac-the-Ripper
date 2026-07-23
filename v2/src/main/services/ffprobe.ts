import { execFile } from 'child_process'
import { promisify } from 'util'
import { getSetting } from '../database/queries/settings'
import { findToolPath, getBundledBinPath } from '../util/platform'
import { createLogger } from '../util/logger'
import { detectBitDepth } from '../util/bit-depth'

const execFileAsync = promisify(execFile)
const log = createLogger('ffprobe')

export interface MediaInfo {
  format: string
  duration: number
  size: number
  bitrate: number
  videoStreams: VideoStreamInfo[]
  audioStreams: AudioStreamInfo[]
  subtitleStreams: SubtitleStreamInfo[]
}

export interface VideoStreamInfo {
  index: number
  codec: string
  codecLongName: string
  width: number
  height: number
  displayAspectRatio: string
  sampleAspectRatio: string
  framerate: string
  framerateNum: number
  framerateDen: number
  isInterlaced: boolean
  fieldOrder: string
  bitDepth: number
  pixelFormat: string
  colorSpace: string
  colorTransfer: string
  colorPrimaries: string
  colorRange: string
  isHDR: boolean
  profile: string
  level: string
}

export interface AudioStreamInfo {
  index: number
  codec: string
  language: string
  channels: number
  channelLayout: string
  sampleRate: number
  bitrate: number
}

export interface SubtitleStreamInfo {
  index: number
  codec: string
  language: string
  type: 'bitmap' | 'text' | 'cc'
  title: string
}

export class FFprobeService {
  private getFFprobePath(): string {
    const bundled = getBundledBinPath('ffprobe')
    if (bundled) return bundled
    const settingPath = getSetting('tools.ffprobe_path')
    if (settingPath) return settingPath
    return findToolPath('ffprobe') || 'ffprobe'
  }

  async analyze(filePath: string): Promise<MediaInfo> {
    const ffprobe = this.getFFprobePath()

    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ], { timeout: 30000 })

    const data = JSON.parse(stdout)
    return this.parseProbeData(data)
  }

  private parseProbeData(data: { format?: Record<string, unknown>; streams?: Array<Record<string, unknown>> }): MediaInfo {
    const format = data.format || {}
    const streams = data.streams || []

    const videoStreams: VideoStreamInfo[] = streams
      .filter((s) => s.codec_type === 'video')
      .map((s) => {
        const [frNum, frDen] = ((s.r_frame_rate as string) || '30/1').split('/').map(Number)
        const fieldOrder = (s.field_order as string) || 'progressive'
        const pixFmt = (s.pix_fmt as string) || 'yuv420p'
        // bits_per_raw_sample is frequently absent for 10-bit HEVC (verified
        // against real hevc_videotoolbox and libx265 output) — pix_fmt's
        // numeric suffix (yuv420p10le, etc.) is the reliable signal.
        const bitDepth = detectBitDepth(pixFmt, s.bits_per_raw_sample)
        const colorTransfer = (s.color_transfer as string) || ''

        return {
          index: s.index as number,
          codec: s.codec_name as string,
          codecLongName: (s.codec_long_name as string) || '',
          width: s.width as number,
          height: s.height as number,
          displayAspectRatio: (s.display_aspect_ratio as string) || '',
          sampleAspectRatio: (s.sample_aspect_ratio as string) || '1:1',
          framerate: `${(frNum / frDen).toFixed(3)}`,
          framerateNum: frNum,
          framerateDen: frDen,
          isInterlaced: fieldOrder !== 'progressive' && fieldOrder !== 'unknown',
          fieldOrder,
          bitDepth,
          pixelFormat: pixFmt,
          colorSpace: (s.color_space as string) || '',
          colorTransfer,
          colorPrimaries: (s.color_primaries as string) || '',
          colorRange: (s.color_range as string) || '',
          isHDR: colorTransfer.includes('smpte2084') || colorTransfer.includes('arib-std-b67'),
          profile: (s.profile as string) || '',
          level: String(s.level ?? '')
        }
      })

    const audioStreams: AudioStreamInfo[] = streams
      .filter((s) => s.codec_type === 'audio')
      .map((s) => ({
        index: s.index as number,
        codec: s.codec_name as string,
        language: (s.tags as Record<string, string>)?.language || 'und',
        channels: (s.channels as number) || 2,
        channelLayout: (s.channel_layout as string) || 'stereo',
        sampleRate: parseInt(String(s.sample_rate)) || 48000,
        bitrate: parseInt(String(s.bit_rate)) || 0
      }))

    const subtitleStreams: SubtitleStreamInfo[] = streams
      .filter((s) => s.codec_type === 'subtitle')
      .map((s) => {
        const codec = s.codec_name as string
        let type: 'bitmap' | 'text' | 'cc' = 'text'
        if (['dvd_subtitle', 'hdmv_pgs_subtitle', 'dvb_subtitle'].includes(codec)) {
          type = 'bitmap'
        } else if (['eia_608', 'cea_608', 'cc_dec'].includes(codec)) {
          type = 'cc'
        }

        return {
          index: s.index as number,
          codec,
          language: (s.tags as Record<string, string>)?.language || 'und',
          type,
          title: (s.tags as Record<string, string>)?.title || ''
        }
      })

    return {
      format: (format.format_name as string) || 'unknown',
      duration: parseFloat(String(format.duration)) || 0,
      size: parseInt(String(format.size)) || 0,
      bitrate: parseInt(String(format.bit_rate)) || 0,
      videoStreams,
      audioStreams,
      subtitleStreams
    }
  }
}
