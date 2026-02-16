import { execFile, exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { runProcess } from '../util/process-runner'
import { getSetting } from '../database/queries/settings'
import { createLogger } from '../util/logger'
import { findToolPath, getPlatform } from '../util/platform'
import { CDRipperService, type CDDiscInfo } from './cd-ripper'
import { MusicBrainzService } from './musicbrainz'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)
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
  discType: 'DVD' | 'BD' | 'UHD_BD' | 'AUDIO_CD'
  discId: string
  fingerprint: string
  trackCount: number
  tracks: TrackInfo[]
  metadata: Record<string, string>
  cdToc?: CDDiscInfo
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
  vtsNumber?: number  // VTS number from lsdvd (1-based), used for ffmpeg VOB fallback
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
  // In-flight guard: deduplicate concurrent scanDrives() calls
  private scanInFlight: Promise<DriveInfo[]> | null = null
  // Reference to the in-flight --noscan process so we can kill it if needed
  private scanProcess: ReturnType<typeof runProcess> | null = null
  // Ripping guard: when a MakeMKV rip/backup is active, skip disc polling
  private _rippingInProgress = false
  // Audio CD services
  private cdRipperService = new CDRipperService()
  private musicBrainzService = new MusicBrainzService()

  get rippingInProgress(): boolean {
    return this._rippingInProgress
  }
  set rippingInProgress(value: boolean) {
    this._rippingInProgress = value
    log.info(`rippingInProgress = ${value}`)
  }

  private getMakeMKVPath(): string | null {
    const settingPath = getSetting('tools.makemkvcon_path')
    if (settingPath && existsSync(settingPath)) return settingPath
    return findToolPath('makemkvcon')
  }

  private hasMakeMKV(): boolean {
    return this.getMakeMKVPath() !== null
  }

  async scanDrives(): Promise<DriveInfo[]> {
    // If a full disc scan or rip is in progress, return cached drives to avoid
    // MakeMKV concurrent access failures (only one instance can run at a time)
    if (this.fullScanInProgress || this._rippingInProgress) {
      log.debug(`scanDrives: skipped — ${this.fullScanInProgress ? 'full disc scan' : 'rip'} in progress, returning cached drives`)
      return this.lastDrives
    }

    // Deduplicate concurrent calls: if a scan is already in flight, piggyback on it
    if (this.scanInFlight) {
      log.debug('scanDrives: scan already in flight, awaiting existing result')
      return this.scanInFlight
    }

    this.scanInFlight = this._scanDrivesImpl()
    try {
      return await this.scanInFlight
    } catch (err) {
      log.warn(`scanDrives: scan failed: ${err}`)
      return this.lastDrives
    } finally {
      this.scanInFlight = null
    }
  }

  /** Kill any in-flight --noscan scan process to free the drive for exclusive access */
  private cancelInFlightScan(): void {
    if (this.scanProcess) {
      log.info('cancelInFlightScan: killing in-flight --noscan process')
      this.scanProcess.kill()
      this.scanProcess = null
    }
    this.scanInFlight = null
  }

  private async _scanDrivesImpl(): Promise<DriveInfo[]> {

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
      this.lastDrives = osInfo
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
      let resolved = false
      const done = () => {
        if (resolved) return
        resolved = true
        this.scanProcess = null
        log.info(`MakeMKV: Found ${drives.length} drive(s)`)
        resolve(drives)
      }

      // Timeout: kill the process if --noscan takes more than 15 seconds
      // (it should complete in 1-3s; hangs happen when the drive is busy)
      const timeout = setTimeout(() => {
        if (!resolved) {
          log.warn('scanDrivesViaMakeMKV: timed out after 15s, killing process')
          if (this.scanProcess) {
            this.scanProcess.kill()
          }
          done()
        }
      }, 15000)

      this.scanProcess = runProcess({
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
          clearTimeout(timeout)
          done()
        }
      })
    })
  }

  async getDiscInfo(discIndex: number): Promise<DiscInfo | null> {
    // Kill any in-flight --noscan polling process before starting a full scan,
    // because MakeMKV cannot handle concurrent drive access
    this.cancelInFlightScan()
    this.fullScanInProgress = true
    log.info(`getDiscInfo(${discIndex}) — acquiring scan lock`)
    try {
      // Try audio CD detection first — cdparanoia -Q is fast (~1s) and
      // must run before MakeMKV which can't handle audio CDs and may hang
      const audioResult = await this.getAudioCDInfo(discIndex)
      if (audioResult) return audioResult

      if (this.hasMakeMKV()) {
        const result = await this.getDiscInfoViaMakeMKV(discIndex)
        if (result) return result

        // MakeMKV failed (timeout, hung, etc.) — try lsdvd fallback for DVDs
        log.warn(`getDiscInfo(${discIndex}) — MakeMKV scan failed, trying lsdvd fallback`)
        const lsdvdResult = await this.getDiscInfoViaLsdvd(discIndex)
        if (lsdvdResult) return lsdvdResult
      }
      return await this.getDiscInfoViaOS(discIndex)
    } finally {
      this.fullScanInProgress = false
      log.info(`getDiscInfo(${discIndex}) — scan lock released`)
    }
  }

  /**
   * Detect audio CDs using cdparanoia -Q.
   * Returns DiscInfo with discType='AUDIO_CD' if the disc is an audio CD, null otherwise.
   */
  private async getAudioCDInfo(discIndex: number): Promise<DiscInfo | null> {
    try {
      // Find the device path from drives list
      const drives = this.lastDrives || []
      const drive = drives[discIndex]
      const devicePath = drive?.devicePath || undefined

      const toc = await this.cdRipperService.queryTOC(devicePath)
      if (!toc || toc.trackCount === 0) {
        log.debug('getAudioCDInfo: not an audio CD (cdparanoia returned no tracks)')
        return null
      }

      log.info(`getAudioCDInfo: Audio CD detected — ${toc.trackCount} tracks, ${toc.totalDurationSeconds.toFixed(0)}s`)

      // Calculate MusicBrainz disc ID
      const discId = this.musicBrainzService.calculateDiscId(toc.trackOffsets, toc.leadOutSector)

      // Build TrackInfo[] from CDTrackInfo[]
      const tracks: TrackInfo[] = toc.tracks.map(t => {
        const h = Math.floor(t.durationSeconds / 3600)
        const m = Math.floor((t.durationSeconds % 3600) / 60)
        const s = Math.floor(t.durationSeconds % 60)
        return {
          id: t.number - 1, // 0-based to match MakeMKV convention
          title: `Track ${t.number}`,
          duration: `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
          durationSeconds: t.durationSeconds,
          size: '',
          sizeBytes: 0,
          chapters: 0,
          resolution: '',
          framerate: '',
          isInterlaced: false,
          audioTracks: [{ id: 0, codec: 'PCM', language: '', channels: 'stereo', bitrate: '1411 kbps' }],
          subtitleTracks: []
        }
      })

      const trackFingerprint = tracks.map(t => `${t.id}:${t.durationSeconds}`).join('|')

      return {
        title: drive?.discTitle || 'Audio CD',
        discType: 'AUDIO_CD',
        discId,
        fingerprint: `${discId}::${toc.trackCount}::${trackFingerprint}`,
        trackCount: toc.trackCount,
        tracks,
        metadata: {
          musicbrainzDiscId: discId,
          devicePath: toc.devicePath,
          leadOutSector: String(toc.leadOutSector),
          scanMethod: 'cdparanoia'
        },
        cdToc: toc
      }
    } catch (err) {
      log.debug(`getAudioCDInfo: failed (not an audio CD or cdparanoia error): ${err}`)
      return null
    }
  }

  // ─── lsdvd fallback (for DVDs when MakeMKV fails) ──────────────────

  private async getDiscInfoViaLsdvd(discIndex: number): Promise<DiscInfo | null> {
    // lsdvd uses libdvdread to parse IFO files — different code path than MakeMKV
    const lsdvdPath = findToolPath('lsdvd')
    if (!lsdvdPath) {
      log.info('lsdvd not available for fallback')
      return null
    }

    // Find the device path from the drives list
    const drives = this.lastDrives || []
    const drive = drives[discIndex]
    if (!drive) {
      log.warn(`lsdvd fallback: no drive at index ${discIndex}`)
      return null
    }

    const devicePath = drive.devicePath || `/dev/rdisk${discIndex + 4}` // fallback guess

    try {
      log.info(`lsdvd fallback: scanning ${devicePath} with JSON output`)
      const { stdout } = await execFileAsync(lsdvdPath, ['-x', '-Oj', devicePath], { timeout: 30000 })

      const info: Partial<DiscInfo> = {
        tracks: [],
        metadata: { scanMethod: 'lsdvd' }
      }

      // Parse JSON output from lsdvd -Oj
      let lsdvdData: Record<string, unknown>
      try {
        lsdvdData = JSON.parse(stdout)
      } catch (parseErr) {
        log.warn(`lsdvd JSON parse failed, falling back to text mode: ${parseErr}`)
        return this.getDiscInfoViaLsdvdText(devicePath, drive)
      }

      info.title = (lsdvdData.title as string) || drive.discTitle || 'Unknown'
      info.discId = (lsdvdData.device as string) || `lsdvd-${devicePath}`
      info.discType = 'DVD' // lsdvd only works with DVDs

      const lsdvdTracks = (lsdvdData.track as Array<Record<string, unknown>>) || []
      const tracks: TrackInfo[] = []

      for (const track of lsdvdTracks) {
        const titleNum = (track.ix as number) || 0
        const durationSeconds = (track.length as number) || 0
        const h = Math.floor(durationSeconds / 3600)
        const m = Math.floor((durationSeconds % 3600) / 60)
        const s = Math.floor(durationSeconds % 60)

        const vtsNumber = (track.vts as number) || undefined
        const chapters = Array.isArray(track.chapter) ? (track.chapter as unknown[]).length : 0

        // Parse audio tracks
        const audioTracks: AudioTrack[] = []
        const audioArr = (track.audio as Array<Record<string, unknown>>) || []
        for (let ai = 0; ai < audioArr.length; ai++) {
          const a = audioArr[ai]
          const ch = (a.channels as number) || 2
          audioTracks.push({
            id: ai,
            codec: (a.format as string) || (a.content as string) || '',
            language: (a.langcode as string) || (a.language as string) || '',
            channels: ch === 6 ? '5.1' : ch === 2 ? 'stereo' : `${ch}ch`,
            bitrate: (a.ap_mode as string) || ''
          })
        }

        // Parse subtitle tracks
        const subtitleTracks: SubtitleTrack[] = []
        const subArr = (track.subp as Array<Record<string, unknown>>) || []
        for (let si = 0; si < subArr.length; si++) {
          const sub = subArr[si]
          subtitleTracks.push({
            id: si,
            type: 'vobsub',
            language: (sub.langcode as string) || (sub.language as string) || '',
            codec: 'dvdsub'
          })
        }

        // Resolution and framerate from JSON (lsdvd -x provides these)
        const width = (track.width as number) || 720
        const height = (track.height as number) || 576
        const fps = (track.fps as number) || 25
        const resolution = `${width}x${height}`

        tracks.push({
          id: titleNum - 1, // MakeMKV uses 0-based, lsdvd uses 1-based
          title: `Title ${titleNum}`,
          duration: `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
          durationSeconds,
          size: '',
          sizeBytes: 0,
          chapters,
          resolution,
          framerate: String(fps),
          isInterlaced: true, // DVDs are typically interlaced
          audioTracks,
          subtitleTracks,
          vtsNumber
        })
      }

      info.tracks = tracks
      info.trackCount = tracks.length

      // If JSON didn't include resolution data, use ffprobe as fallback
      const needsProbe = tracks.length > 0 && tracks[0].resolution === '720x576' && !(lsdvdData.track as Array<Record<string, unknown>>)?.[0]?.width
      if (needsProbe) {
        try {
          const mountPoint = this.findMountPoint(drive.discTitle || info.title || '')
          if (mountPoint) {
            const ffprobe = findToolPath('ffprobe')
            if (ffprobe) {
              const vob = `${mountPoint}/VIDEO_TS/VTS_01_1.VOB`
              if (existsSync(vob)) {
                const { stdout: probeOut } = await execFileAsync(ffprobe, [
                  '-hide_banner', '-select_streams', 'v:0',
                  '-show_entries', 'stream=width,height,r_frame_rate,field_order',
                  '-of', 'csv=p=0', vob
                ], { timeout: 10000 })
                const probeParts = probeOut.trim().split(',')
                if (probeParts.length >= 3) {
                  const w = probeParts[0]
                  const hVal = probeParts[1]
                  const fpsStr = probeParts[2]
                  const fpsParts = fpsStr.split('/')
                  const fpsVal = fpsParts.length === 2
                    ? String(Math.round(parseInt(fpsParts[0]) / parseInt(fpsParts[1]) * 100) / 100)
                    : fpsStr
                  const res = `${w}x${hVal}`
                  const interlaced = (probeParts[3] || '').includes('tt') || (probeParts[3] || '').includes('tb')

                  log.info(`lsdvd+ffprobe: resolution=${res} fps=${fpsVal} interlaced=${interlaced}`)
                  for (const t of tracks) {
                    t.resolution = res
                    t.framerate = fpsVal
                    t.isInterlaced = interlaced
                  }
                }
              }
            }
          }
        } catch (err) {
          log.debug(`lsdvd ffprobe enhancement failed: ${err}`)
        }
      }

      // Compute fingerprint
      const trackFingerprint = tracks.map(t => `${t.id}:${t.durationSeconds}`).join('|')
      info.fingerprint = `${info.discId}::${tracks.length}::${trackFingerprint}`

      log.info(`lsdvd fallback result: title="${info.title}" type=DVD discId="${info.discId}" tracks=${info.trackCount}`)
      return info as DiscInfo
    } catch (err) {
      log.error(`lsdvd fallback failed: ${err}`)
      return null
    }
  }

  findMountPoint(discTitle: string): string | null {
    // Check common mount points for the disc
    const candidates = [
      `/Volumes/${discTitle}`,
      `/Volumes/${discTitle.replace(/\s+/g, '_')}`,
      `/Volumes/${discTitle.toUpperCase()}`
    ]
    for (const path of candidates) {
      if (existsSync(`${path}/VIDEO_TS`)) return path
    }
    return null
  }

  /** Text-mode lsdvd fallback when JSON output (-Oj) is not supported */
  private async getDiscInfoViaLsdvdText(devicePath: string, drive: DriveInfo): Promise<DiscInfo | null> {
    const lsdvdPath = findToolPath('lsdvd')
    if (!lsdvdPath) return null

    try {
      const { stdout } = await execFileAsync(lsdvdPath, ['-a', '-s', '-c', devicePath], { timeout: 30000 })

      const info: Partial<DiscInfo> = {
        tracks: [],
        metadata: { scanMethod: 'lsdvd-text' }
      }

      const titleMatch = stdout.match(/^Disc Title:\s*(.+)/m)
      info.title = titleMatch ? titleMatch[1].trim() : drive.discTitle || 'Unknown'
      const discIdMatch = stdout.match(/^DVDDiscID:\s*(\S+)/m)
      info.discId = discIdMatch ? discIdMatch[1] : `lsdvd-${devicePath}`
      info.discType = 'DVD'

      const titleRegex = /^Title:\s*(\d+),\s*Length:\s*([\d:.]+)\s*Chapters:\s*(\d+).*Audio streams:\s*(\d+).*Subpictures:\s*(\d+)/gm
      let match: RegExpExecArray | null
      const tracks: TrackInfo[] = []

      while ((match = titleRegex.exec(stdout)) !== null) {
        const titleNum = parseInt(match[1], 10)
        const duration = match[2]
        const chapters = parseInt(match[3], 10)

        const parts = duration.split(':')
        const h = parseInt(parts[0], 10) || 0
        const m = parseInt(parts[1], 10) || 0
        const s = parseFloat(parts[2]) || 0
        const durationSeconds = h * 3600 + m * 60 + s

        const audioTracks: AudioTrack[] = []
        const titleSection = stdout.substring(match.index)
        const nextTitleIdx = titleSection.indexOf('\nTitle:', 1)
        const section = nextTitleIdx > 0 ? titleSection.substring(0, nextTitleIdx) : titleSection
        const audioRegex = /Audio:\s*(\d+).*Language:\s*(\w+).*Format:\s*(\w+).*Channels:\s*(\d+)/g
        let audioMatch: RegExpExecArray | null
        while ((audioMatch = audioRegex.exec(section)) !== null) {
          audioTracks.push({
            id: parseInt(audioMatch[1], 10),
            codec: audioMatch[3],
            language: audioMatch[2],
            channels: audioMatch[4] === '6' ? '5.1' : audioMatch[4] === '2' ? 'stereo' : audioMatch[4] + 'ch',
            bitrate: ''
          })
        }

        const subtitleTracks: SubtitleTrack[] = []
        const subRegex = /Subtitle:\s*(\d+).*Language:\s*(\w+)/g
        let subMatch: RegExpExecArray | null
        while ((subMatch = subRegex.exec(section)) !== null) {
          subtitleTracks.push({
            id: parseInt(subMatch[1], 10),
            type: 'vobsub',
            language: subMatch[2],
            codec: 'dvdsub'
          })
        }

        tracks.push({
          id: titleNum - 1,
          title: `Title ${titleNum}`,
          duration: `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}`,
          durationSeconds,
          size: '',
          sizeBytes: 0,
          chapters,
          resolution: '720x576',
          framerate: '25',
          isInterlaced: true,
          audioTracks,
          subtitleTracks
        })
      }

      info.tracks = tracks
      info.trackCount = tracks.length

      const trackFingerprint = tracks.map(t => `${t.id}:${t.durationSeconds}`).join('|')
      info.fingerprint = `${info.discId}::${tracks.length}::${trackFingerprint}`

      log.info(`lsdvd text fallback result: title="${info.title}" tracks=${info.trackCount}`)
      return info as DiscInfo
    } catch (err) {
      log.error(`lsdvd text fallback failed: ${err}`)
      return null
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
      let resolved = false
      let lastActivityTime = Date.now()
      const scanStartTime = Date.now()
      let activityTimer: ReturnType<typeof setInterval> | null = null
      let inAnalysisPhase = false

      // MakeMKV's disc analysis phase (after "Using direct disc access mode")
      // is legitimately silent for 3-7+ minutes on complex discs with many titles.
      // DVD extras discs with 20+ titles can take especially long.
      // However, a deadlocked process shows 0% CPU immediately — a working
      // MakeMKV always has CPU activity (CSS key exchange, IFO parsing, disc I/O).
      const HARD_TIMEOUT_MS = 10 * 60 * 1000    // 10 min absolute max
      const ACTIVITY_TIMEOUT_MS = 6 * 60 * 1000  // 6 min no output = stuck
      const HEALTH_CHECK_INTERVAL_MS = 15000     // Check every 15s (was 30s)
      const ZERO_CPU_KILL_COUNT = 3              // Kill after 3 consecutive 0% CPU readings
      const ZERO_CPU_SILENCE_GATE_MS = 60000     // AND at least 60s of silence

      const finish = (result: DiscInfo | null) => {
        if (resolved) return
        resolved = true
        if (activityTimer) clearInterval(activityTimer)
        const elapsed = ((Date.now() - scanStartTime) / 1000).toFixed(1)
        log.info(`getDiscInfo(${discIndex}) — finished in ${elapsed}s (${result ? `${result.trackCount} tracks` : 'failed'})`)
        resolve(result)
      }

      // Hard safety timeout
      const timeout = setTimeout(() => {
        if (!resolved) {
          log.error(`getDiscInfo(${discIndex}) — hard timeout after 10 minutes, killing process`)
          proc.kill()
          finish(null)
        }
      }, HARD_TIMEOUT_MS)

      const proc = runProcess({
        command: makemkvcon,
        args: ['--robot', 'info', `disc:${discIndex}`],
        onStdout: (line) => {
          lastActivityTime = Date.now()

          // Detect disc analysis phase (MakeMKV goes silent while reading disc structure)
          if (line.includes('direct disc access mode') || line.includes('Opening disc')) {
            inAnalysisPhase = true
            log.info(`MakeMKV: Entered disc analysis phase — this can take several minutes for complex discs`)
          }

          // Log everything for debugging disc scan issues
          if (line.startsWith('MSG:')) {
            const match = line.match(/MSG:\d+,\d+,\d+,"(.+)"/)
            if (match) log.info(`MakeMKV: ${match[1]}`)
          } else if (line.startsWith('PRGC:') || line.startsWith('PRGT:') || line.startsWith('PRGV:')) {
            // Log progress at info level during analysis phase for visibility
            if (inAnalysisPhase) {
              log.info(`MakeMKV progress: ${line}`)
              inAnalysisPhase = false // Got progress, analysis phase ended
            } else {
              log.debug(`MakeMKV progress: ${line}`)
            }
          } else if (line.startsWith('CINFO:') || line.startsWith('TCOUNT:')) {
            if (inAnalysisPhase) inAnalysisPhase = false
            log.info(`MakeMKV info: ${line}`)
          } else if (line.startsWith('TINFO:') || line.startsWith('SINFO:')) {
            if (inAnalysisPhase) inAnalysisPhase = false
            log.debug(`MakeMKV track: ${line}`)
          } else {
            log.info(`MakeMKV: ${line}`)
          }

          this.parseInfoLine(line, info, trackMap)
        },
        onStderr: (line) => {
          lastActivityTime = Date.now()
          // Promote stderr to info level — MakeMKV sometimes outputs useful diagnostics here
          log.info(`MakeMKV stderr: ${line}`)
        },
        onExit: (code) => {
          clearTimeout(timeout)
          if (activityTimer) clearInterval(activityTimer)
          if (code !== 0) {
            log.error(`MakeMKV info failed with code ${code}`)
            finish(null)
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
          finish(info as DiscInfo)
        }
      })

      log.info(`getDiscInfo(${discIndex}) — MakeMKV process spawned with pid=${proc.pid}`)

      // Activity watchdog: periodically check process health and kill if truly stuck.
      // A deadlocked MakeMKV shows 0% CPU immediately and never recovers.
      // A legitimate scan always has CPU activity (CSS keys, IFO parsing, I/O).
      let consecutiveZeroCpu = 0
      activityTimer = setInterval(async () => {
        const silentMs = Date.now() - lastActivityTime
        const totalMs = Date.now() - scanStartTime
        const silentSec = Math.round(silentMs / 1000)
        const totalSec = Math.round(totalMs / 1000)

        if (silentMs >= ACTIVITY_TIMEOUT_MS) {
          log.error(`getDiscInfo(${discIndex}) — no output for ${silentSec}s (total elapsed: ${totalSec}s), killing process`)
          proc.kill()
          finish(null)
          return
        }

        // Check process health during silence periods (after 30s of silence)
        if (silentMs >= 30000 && proc.pid > 0) {
          try {
            const { stdout } = await execAsync(`ps -p ${proc.pid} -o %cpu=,rss=,state=`)
            const parts = stdout.trim().split(/\s+/)
            const cpu = parseFloat(parts[0] || '0')
            const rssMb = Math.round(parseInt(parts[1] || '0', 10) / 1024)
            const state = parts[2] || '?'

            log.info(`getDiscInfo(${discIndex}) — process health: pid=${proc.pid} cpu=${cpu}% mem=${rssMb}MB state=${state} silent=${silentSec}s elapsed=${totalSec}s`)

            // Track consecutive zero-CPU readings (process is truly stuck, not doing I/O)
            if (cpu < 0.5) {
              consecutiveZeroCpu++
            } else {
              consecutiveZeroCpu = 0
            }

            // Kill after N consecutive 0% CPU readings AND sufficient silence.
            // With 15s interval: 3 checks = 45s of confirmed 0% CPU, kills at ~60s total.
            if (consecutiveZeroCpu >= ZERO_CPU_KILL_COUNT && silentMs >= ZERO_CPU_SILENCE_GATE_MS) {
              log.error(`getDiscInfo(${discIndex}) — process appears hung (0% CPU for ${consecutiveZeroCpu * (HEALTH_CHECK_INTERVAL_MS / 1000)}s, silent for ${silentSec}s), killing`)
              proc.kill()
              finish(null)
              return
            }
          } catch {
            // ps failed — process may have already exited
            log.warn(`getDiscInfo(${discIndex}) — could not check process health (pid=${proc.pid}, may have exited)`)
          }
        } else if (silentMs >= 30000) {
          log.info(`getDiscInfo(${discIndex}) — waiting for MakeMKV output (silent for ${silentSec}s, total elapsed: ${totalSec}s)`)
        }
      }, HEALTH_CHECK_INTERVAL_MS)
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

// Singleton instance — shared across all IPC handlers
let discDetectionInstance: DiscDetectionService | null = null
export function getDiscDetectionService(): DiscDetectionService {
  if (!discDetectionInstance) {
    discDetectionInstance = new DiscDetectionService()
  }
  return discDetectionInstance
}
