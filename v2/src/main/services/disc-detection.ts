import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { runProcess } from '../util/process-runner'
import { getSetting } from '../database/queries/settings'
import { createLogger } from '../util/logger'
import { findToolPath, getPlatform } from '../util/platform'

const execFileAsync = promisify(execFile)
const log = createLogger('disc-detection')

export interface DriveInfo {
  index: number
  name: string
  devicePath: string
  discTitle: string | null
  discType: string | null
}

export interface DiscInfo {
  title: string
  discType: 'DVD' | 'BD' | 'UHD_BD'
  discId: string
  fingerprint: string
  trackCount: number
  tracks: TrackInfo[]
  metadata: Record<string, string>
}

export interface TrackInfo {
  id: number
  title: string
  duration: string
  durationSeconds: number
  size: string
  sizeBytes: number
  chapters: number
  resolution: string
  framerate: string
  isInterlaced: boolean
  audioTracks: AudioTrack[]
  subtitleTracks: SubtitleTrack[]
}

export interface AudioTrack {
  id: number
  codec: string
  language: string
  channels: string
  bitrate: string
}

export interface SubtitleTrack {
  id: number
  type: 'vobsub' | 'pgs' | 'srt' | 'cc608' | 'cc708' | 'unknown'
  language: string
  codec: string
}

export class DiscDetectionService {
  // Track last scan result to suppress repetitive logging
  private lastScanHash = ''
  // Mutex: when a full disc scan (getDiscInfo) is running, block polling scans
  // to prevent MakeMKV concurrent access failures
  private fullScanInProgress = false
  private lastDrives: DriveInfo[] = []

  private getMakeMKVPath(): string | null {
    const settingPath = getSetting('tools.makemkvcon_path')
    if (settingPath && existsSync(settingPath)) return settingPath
    return findToolPath('makemkvcon')
  }

  private hasMakeMKV(): boolean {
    return this.getMakeMKVPath() !== null
  }

  async scanDrives(): Promise<DriveInfo[]> {
    // If a full disc scan is in progress, return cached drives to avoid
    // MakeMKV concurrent access failures (only one instance can run at a time)
    if (this.fullScanInProgress) {
      log.debug('scanDrives: skipped — full disc scan in progress, returning cached drives')
      return this.lastDrives
    }

    // Get hardware drive list from MakeMKV (gives drive model name)
    // Then enrich with OS-level detection (gives disc title, device path, disc type)
    // MakeMKV --noscan doesn't reliably detect disc presence on macOS
    let drives: DriveInfo[] = []

    if (this.hasMakeMKV()) {
      drives = await this.scanDrivesViaMakeMKV()
    }

    const osInfo = await this.scanDrivesViaOS()
    log.debug(`scanDrives: MakeMKV found ${drives.length} drive(s), OS found ${osInfo.length} drive(s)`)

    if (drives.length === 0) {
      return osInfo
    }

    // Merge: enrich MakeMKV drives with OS-level disc info
    if (osInfo.length > 0) {
      for (const drive of drives) {
        // Match by index (usually just one optical drive) or use first OS result
        const os = osInfo.find(o => o.index === drive.index) || osInfo[0]
        if (!drive.discTitle && os.discTitle) {
          drive.discTitle = os.discTitle
          log.debug(`scanDrives: Enriched drive ${drive.index} with OS disc title: "${os.discTitle}"`)
        }
        if (!drive.discType && os.discType) {
          drive.discType = os.discType
          log.debug(`scanDrives: Enriched drive ${drive.index} with OS disc type: ${os.discType}`)
        }
        if (!drive.devicePath && os.devicePath) {
          drive.devicePath = os.devicePath
        }
      }
    }

    // Only log at info level when state changes; debug level for repeat scans
    const hash = JSON.stringify(drives.map(d => ({ i: d.index, t: d.discTitle, dt: d.discType })))
    if (hash !== this.lastScanHash) {
      this.lastScanHash = hash
      log.info(`scanDrives: ${JSON.stringify(drives.map(d => ({ index: d.index, name: d.name, discTitle: d.discTitle, discType: d.discType })))}`)
    } else {
      log.debug('scanDrives: no change')
    }
    this.lastDrives = drives
    return drives
  }

  async detectDiscs(): Promise<DriveInfo[]> {
    return this.scanDrives()
  }

  // ─── macOS drutil/diskutil fallback ──────────────────────────────────

  private async scanDrivesViaOS(): Promise<DriveInfo[]> {
    const platform = getPlatform()
    if (platform === 'mac') {
      return this.scanDrivesViaDrutil()
    }
    if (platform === 'linux') {
      return this.scanDrivesViaLinux()
    }
    log.warn('OS-level disc detection not supported on this platform')
    return []
  }

  private async scanDrivesViaDrutil(): Promise<DriveInfo[]> {
    const drives: DriveInfo[] = []

    try {
      // drutil status gives us the optical drive info
      const { stdout } = await execFileAsync('drutil', ['status'], { timeout: 10000 })
      log.debug(`drutil status output:\n${stdout}`)

      if (stdout.includes('No burning possible')) {
        // No drive or no disc
        log.info('drutil: no optical drive or no disc detected')
      }

      // Parse drutil output
      const vendorMatch = stdout.match(/Vendor\s+Product\s+Rev\s*\n\s*(.+)/m)
      const typeMatch = stdout.match(/Type:\s+(\S+)/m)
      const nameMatch = stdout.match(/Name:\s+(\S+)/m)
      const bookTypeMatch = stdout.match(/Book Type:\s+(.+)/m)

      if (nameMatch) {
        const devicePath = nameMatch[1] // e.g., /dev/disk4
        const driveName = vendorMatch ? vendorMatch[1].trim() : 'Optical Drive'
        const bookType = bookTypeMatch ? bookTypeMatch[1].trim() : ''

        // Get disc title from diskutil or volume name
        let discTitle: string | null = null
        let discType: string | null = null

        try {
          const { stdout: diskutilOut } = await execFileAsync(
            'diskutil', ['info', devicePath], { timeout: 10000 }
          )

          const volNameMatch = diskutilOut.match(/Volume Name:\s+(.+)/m)
          if (volNameMatch) {
            discTitle = volNameMatch[1].trim()
          }

          // Also check disk label from diskutil list
          if (!discTitle) {
            const { stdout: listOut } = await execFileAsync(
              'diskutil', ['list', devicePath], { timeout: 10000 }
            )
            const labelMatch = listOut.match(/\d+:\s+\S+\s+(.+?)\s+\*?[\d.]+\s+[GMKT]B/m)
            if (labelMatch) {
              discTitle = labelMatch[1].trim()
            }
          }
        } catch (err) {
          log.warn(`diskutil failed for ${devicePath}: ${err}`)
        }

        log.debug(`drutil: devicePath=${devicePath} driveName="${driveName}" bookType="${bookType}" discTitle="${discTitle}"`)

        // Determine disc type from drutil Book Type
        if (bookType.includes('BD') || bookType.includes('Blu-ray')) {
          discType = bookType.includes('UHD') ? 'UHD_BD' : 'BD'
        } else if (bookType.includes('DVD')) {
          discType = 'DVD'
        } else {
          // Infer from size
          const sizeMatch = stdout.match(/Space Used:.*?([\d.]+)(GB|MB)/m)
          if (sizeMatch) {
            const sizeGB = sizeMatch[2] === 'GB' ? parseFloat(sizeMatch[1]) : parseFloat(sizeMatch[1]) / 1024
            if (sizeGB > 25) discType = 'BD'
            else discType = 'DVD'
          } else {
            discType = 'DVD'
          }
        }

        drives.push({
          index: 0,
          name: driveName,
          devicePath,
          discTitle,
          discType
        })

        log.debug(`drutil: Found drive "${driveName}" at ${devicePath} with disc "${discTitle}" (${discType})`)
      }
    } catch (err) {
      log.error(`drutil scan failed: ${err}`)
    }

    return drives
  }

  private async scanDrivesViaLinux(): Promise<DriveInfo[]> {
    const drives: DriveInfo[] = []

    try {
      // Check /dev/sr0, /dev/sr1, etc.
      for (let i = 0; i < 4; i++) {
        const dev = `/dev/sr${i}`
        if (existsSync(dev)) {
          let discTitle: string | null = null
          try {
            const { stdout } = await execFileAsync('blkid', [dev], { timeout: 5000 })
            const labelMatch = stdout.match(/LABEL="([^"]+)"/)
            if (labelMatch) discTitle = labelMatch[1]
          } catch {}

          drives.push({
            index: i,
            name: `Optical Drive ${i}`,
            devicePath: dev,
            discTitle,
            discType: 'DVD'
          })
        }
      }
    } catch (err) {
      log.error(`Linux drive scan failed: ${err}`)
    }

    return drives
  }

  // ─── MakeMKV-based scanning ──────────────────────────────────────────

  private async scanDrivesViaMakeMKV(): Promise<DriveInfo[]> {
    const makemkvcon = this.getMakeMKVPath()!
    const drives: DriveInfo[] = []

    return new Promise((resolve) => {
      runProcess({
        command: makemkvcon,
        args: ['--robot', '--noscan', 'info', 'disc:9999'],
        onStdout: (line) => {
          // Parse DRV lines: DRV:index,flags,disc_count,disc_info_flags,"drive_name","disc_name","device_path"
          // flags: 256 = no drive present at this slot, 0 = drive present (no disc), 2 = drive with disc inserted
          if (line.startsWith('DRV:')) {
            log.debug(`MakeMKV DRV raw: ${line}`)
            const parts = line.substring(4).split(',')
            const index = parseInt(parts[0])
            const flags = parseInt(parts[1])
            const discCount = parts[2]
            const discInfoFlags = parts[3]
            const driveName = parts[4]?.replace(/"/g, '') || ''
            const discName = parts[5]?.replace(/"/g, '') || ''
            const devicePath = parts[6]?.replace(/"/g, '') || ''

            log.debug(`MakeMKV DRV parsed: index=${index} flags=${flags} discCount=${discCount} discInfoFlags=${discInfoFlags} drive="${driveName}" disc="${discName}" path="${devicePath}"`)

            // flags=256 means "no drive at this slot" — skip those
            // flags=0 means drive present (empty), flags=2 means drive with disc
            if (flags !== 256 && driveName) {
              const discInserted = (flags & 2) !== 0

              // Infer disc type from drive name when disc is present
              // Actual type will be determined by getDiscInfo() later
              let discType: string | null = null
              if (discInserted) {
                const upper = driveName.toUpperCase()
                if (upper.includes('BD')) discType = 'BD'
                else if (upper.includes('DVD')) discType = 'DVD'
                else discType = 'BD'
              }

              const driveInfo = {
                index,
                name: driveName,
                devicePath,
                discTitle: discName || null,
                discType
              }
              log.debug(`MakeMKV drive result: ${JSON.stringify(driveInfo)}`)
              drives.push(driveInfo)
            } else {
              log.debug(`MakeMKV DRV skipped: flags=${flags} driveName="${driveName}"`)
            }
          }
        },
        onExit: () => {
          log.info(`MakeMKV: Found ${drives.length} drive(s)`)
          resolve(drives)
        }
      })
    })
  }

  async getDiscInfo(discIndex: number): Promise<DiscInfo | null> {
    this.fullScanInProgress = true
    log.info(`getDiscInfo(${discIndex}) — acquiring scan lock`)
    try {
      if (this.hasMakeMKV()) {
        return await this.getDiscInfoViaMakeMKV(discIndex)
      }
      return await this.getDiscInfoViaOS(discIndex)
    } finally {
      this.fullScanInProgress = false
      log.info(`getDiscInfo(${discIndex}) — scan lock released`)
    }
  }

  // ─── OS-level disc info (limited, no track details) ──────────────────

  private async getDiscInfoViaOS(discIndex: number): Promise<DiscInfo | null> {
    const platform = getPlatform()
    if (platform !== 'mac') return null

    try {
      const { stdout } = await execFileAsync('drutil', ['status'], { timeout: 10000 })

      const nameMatch = stdout.match(/Name:\s+(\S+)/m)
      if (!nameMatch) return null

      const devicePath = nameMatch[1]
      const bookTypeMatch = stdout.match(/Book Type:\s+(.+)/m)
      const bookType = bookTypeMatch ? bookTypeMatch[1].trim() : ''
      const sizeMatch = stdout.match(/Space Used:\s+[\d:]+\s+blocks:\s+\d+\s+\/\s+([\d.]+)(GB|MB)/m)

      // Get disc title
      let discTitle = 'Unknown Disc'
      try {
        const { stdout: listOut } = await execFileAsync('diskutil', ['list', devicePath], { timeout: 10000 })
        const titleMatch = listOut.match(/\d+:\s+\S*\s+(\S+)\s+\*?[\d.]+/m)
        if (titleMatch) discTitle = titleMatch[1].trim()
      } catch {}

      let discType: 'DVD' | 'BD' | 'UHD_BD' = 'DVD'
      if (bookType.includes('BD') || bookType.includes('Blu-ray')) {
        discType = bookType.includes('UHD') ? 'UHD_BD' : 'BD'
      }

      const totalSize = sizeMatch
        ? (sizeMatch[2] === 'GB' ? `${sizeMatch[1]} GB` : `${sizeMatch[1]} MB`)
        : 'Unknown'

      return {
        title: discTitle,
        discType,
        discId: devicePath,
        fingerprint: `${devicePath}::0::`,
        trackCount: 0,
        tracks: [],
        metadata: {
          devicePath,
          bookType,
          totalSize,
          note: 'Install MakeMKV to see individual title tracks, audio streams, and subtitle tracks. OS-level detection shows the disc but cannot enumerate its contents.'
        }
      }
    } catch (err) {
      log.error(`OS disc info failed: ${err}`)
      return null
    }
  }

  // ─── MakeMKV-based disc info ─────────────────────────────────────────

  private async getDiscInfoViaMakeMKV(discIndex: number): Promise<DiscInfo | null> {
    const makemkvcon = this.getMakeMKVPath()!
    const info: Partial<DiscInfo> = {
      tracks: [],
      metadata: {}
    }
    const trackMap = new Map<number, TrackInfo>()

    log.info(`getDiscInfo(${discIndex}) — scanning disc...`)
    return new Promise((resolve) => {
      runProcess({
        command: makemkvcon,
        args: ['--robot', 'info', `disc:${discIndex}`],
        onStdout: (line) => {
          if (line.startsWith('CINFO:') || line.startsWith('TCOUNT:')) {
            log.info(`MakeMKV info: ${line}`)
          }
          this.parseInfoLine(line, info, trackMap)
        },
        onStderr: (line) => {
          log.debug(`MakeMKV stderr: ${line}`)
        },
        onExit: (code) => {
          if (code !== 0) {
            log.error(`MakeMKV info failed with code ${code}`)
            resolve(null)
            return
          }

          info.tracks = Array.from(trackMap.values())
          info.trackCount = info.tracks.length

          if (!info.discType) {
            info.discType = 'DVD'
          }

          // Compute fingerprint from discId + track structure for reliable change detection
          const trackFingerprint = info.tracks.map(t => `${t.id}:${t.durationSeconds}`).join('|')
          info.fingerprint = `${info.discId}::${info.tracks.length}::${trackFingerprint}`

          log.info(`getDiscInfo result: title="${info.title}" type=${info.discType} discId="${info.discId}" fingerprint="${info.fingerprint}" tracks=${info.trackCount}`)
          resolve(info as DiscInfo)
        }
      })
    })
  }

  private parseInfoLine(line: string, info: Partial<DiscInfo>, trackMap: Map<number, TrackInfo>): void {
    // CINFO: disc-level info
    if (line.startsWith('CINFO:')) {
      const match = line.match(/CINFO:(\d+),(\d+),"?([^"]*)"?/)
      if (match) {
        const [, attrId, , value] = match
        switch (attrId) {
          case '2': // Title
            info.title = value
            break
          case '28': // Disc type comment
            if (value.includes('Blu-ray')) {
              info.discType = value.includes('UHD') ? 'UHD_BD' : 'BD'
            } else {
              info.discType = 'DVD'
            }
            break
          case '30': // Volume name / disc ID
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
            track.durationSeconds = this.parseDuration(value)
            break
          case '10':
            track.size = value
            track.sizeBytes = this.parseSize(value)
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

    // SINFO: stream-level info (audio/subtitle tracks within a title)
    if (line.startsWith('SINFO:')) {
      const match = line.match(/SINFO:(\d+),(\d+),(\d+),(\d+),"?([^"]*)"?/)
      if (match) {
        const [, trackIdStr, streamIdStr, attrId, streamType, value] = match
        const trackId = parseInt(trackIdStr)
        const streamId = parseInt(streamIdStr)
        const track = trackMap.get(trackId)
        if (!track) return

        if (streamType === '2' || attrId === '1') {
          this.parseAudioStream(track, streamId, attrId, value)
        } else if (streamType === '3') {
          this.parseSubtitleStream(track, streamId, attrId, value)
        }
      }
    }
  }

  private parseAudioStream(track: TrackInfo, streamId: number, attrId: string, value: string): void {
    let audio = track.audioTracks.find(a => a.id === streamId)
    if (!audio) {
      audio = { id: streamId, codec: '', language: '', channels: '', bitrate: '' }
      track.audioTracks.push(audio)
    }
    switch (attrId) {
      case '2': audio.codec = value; break
      case '3': audio.language = value; break
      case '4': audio.channels = value; break
      case '5': audio.bitrate = value; break
    }
  }

  private parseSubtitleStream(track: TrackInfo, streamId: number, attrId: string, value: string): void {
    let sub = track.subtitleTracks.find(s => s.id === streamId)
    if (!sub) {
      sub = { id: streamId, type: 'unknown', language: '', codec: '' }
      track.subtitleTracks.push(sub)
    }
    switch (attrId) {
      case '2':
        sub.codec = value
        if (value.includes('VobSub')) sub.type = 'vobsub'
        else if (value.includes('PGS')) sub.type = 'pgs'
        else if (value.includes('SRT')) sub.type = 'srt'
        else if (value.includes('608')) sub.type = 'cc608'
        else if (value.includes('708')) sub.type = 'cc708'
        break
      case '3': sub.language = value; break
    }
  }

  private parseDuration(str: string): number {
    const parts = str.split(':').map(Number)
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return parts[0] || 0
  }

  private parseSize(str: string): number {
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
}
