import { execFile } from 'child_process'
import { promisify } from 'util'
import { getSetting } from '../database/queries/settings'
import { findToolPath, getBundledBinPath } from '../util/platform'
import { createLogger } from '../util/logger'

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
  width: number
  height: number
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
  isHDR: boolean
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

  async detectInterlacing(filePath: string): Promise<{ isInterlaced: boolean; fieldOrder: string }> {
    const ffprobe = this.getFFprobePath()

    try {
      const { stdout } = await execFileAsync(ffprobe, [
        '-v', 'quiet',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=field_order',
        '-print_format', 'json',
        filePath
      ], { timeout: 15000 })

      const data = JSON.parse(stdout)
      const fieldOrder = data.streams?.[0]?.field_order || 'progressive'
      const isInterlaced = fieldOrder !== 'progressive' && fieldOrder !== 'unknown'

      return { isInterlaced, fieldOrder }
    } catch {
      return { isInterlaced: false, fieldOrder: 'unknown' }
    }
  }

  async detectFramerate(filePath: string): Promise<{ fps: string; isFilm: boolean; region: string }> {
    const ffprobe = this.getFFprobePath()

    try {
      const { stdout } = await execFileAsync(ffprobe, [
        '-v', 'quiet',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=r_frame_rate,avg_frame_rate',
        '-print_format', 'json',
        filePath
      ], { timeout: 15000 })

      const data = JSON.parse(stdout)
      const stream = data.streams?.[0]
      const rFrameRate = stream?.r_frame_rate || '30000/1001'

      const [num, den] = rFrameRate.split('/').map(Number)
      const fps = den > 0 ? num / den : 30

      let region = 'NTSC'
      let isFilm = false

      if (Math.abs(fps - 23.976) < 0.1 || Math.abs(fps - 24) < 0.1) {
        isFilm = true
        region = 'FILM'
      } else if (Math.abs(fps - 25) < 0.1) {
        region = 'PAL'
      } else if (Math.abs(fps - 29.97) < 0.1 || Math.abs(fps - 30) < 0.1) {
        region = 'NTSC'
      } else if (Math.abs(fps - 50) < 0.1 || Math.abs(fps - 59.94) < 0.1) {
        region = fps > 30 ? 'HD' : 'NTSC'
      }

      return { fps: fps.toFixed(3).replace(/\.?0+$/, ''), isFilm, region }
    } catch {
      return { fps: '29.97', isFilm: false, region: 'NTSC' }
    }
  }

  private parseProbeData(data: { format?: Record<string, unknown>; streams?: Array<Record<string, unknown>> }): MediaInfo {
    const format = data.format || {}
    const streams = data.streams || []

    const videoStreams: VideoStreamInfo[] = streams
      .filter((s) => s.codec_type === 'video')
      .map((s) => {
        const [frNum, frDen] = ((s.r_frame_rate as string) || '30/1').split('/').map(Number)
        const fieldOrder = (s.field_order as string) || 'progressive'
        const bitDepth = parseInt(String(s.bits_per_raw_sample || s.bits_per_component || 8))
        const colorTransfer = (s.color_transfer as string) || ''

        return {
          index: s.index as number,
          codec: s.codec_name as string,
          width: s.width as number,
          height: s.height as number,
          framerate: `${(frNum / frDen).toFixed(3)}`,
          framerateNum: frNum,
          framerateDen: frDen,
          isInterlaced: fieldOrder !== 'progressive' && fieldOrder !== 'unknown',
          fieldOrder,
          bitDepth,
          pixelFormat: (s.pix_fmt as string) || 'yuv420p',
          colorSpace: (s.color_space as string) || '',
          colorTransfer,
          colorPrimaries: (s.color_primaries as string) || '',
          isHDR: colorTransfer.includes('smpte2084') || colorTransfer.includes('arib-std-b67')
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
