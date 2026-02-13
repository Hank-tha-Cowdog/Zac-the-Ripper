import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'fs'
import { join, basename, extname } from 'path'
import { createLogger } from '../util/logger'

const log = createLogger('kodi-output')

// ─── Types ─────────────────────────────────────────────────────────────

export interface KodiMovieParams {
  libraryPath: string
  title: string
  year: number
  sourceFile: string
  metadata?: {
    originalTitle?: string
    sortTitle?: string
    plot?: string
    tagline?: string
    genres?: string[]
    runtime?: number
    mpaa?: string
    studio?: string
    country?: string
    premiered?: string
    tmdb_id?: number
    imdb_id?: string
    voteAverage?: number
    voteCount?: number
    actors?: Array<{ name: string; role: string; order: number; thumb?: string }>
    director?: string
    credits?: string
  }
  artwork?: {
    poster?: string      // 1000x1500 JPG
    fanart?: string      // 1920x1080 JPG
    banner?: string      // 1000x185 JPG
    clearlogo?: string   // 800x310 PNG (transparent)
    clearart?: string    // 1000x562 PNG (transparent)
    landscape?: string   // 1000x562 JPG
    discart?: string     // 1000x1000 PNG (transparent, round)
    keyart?: string      // 1000x1500 JPG
  }
  streamDetails?: {
    videoCodec?: string       // h264, hevc, mpeg2video, ffv1
    videoWidth?: number
    videoHeight?: number
    videoAspect?: string      // e.g., "2.400000"
    videoDuration?: number    // seconds
    hdrType?: string          // hdr10, dolbyvision, hlg, hdr10plus, or empty
    audioTracks?: Array<{
      codec: string           // ac3, truehd, dtshd_ma, dts, aac, flac
      language: string        // ISO 639-2 (eng, fre, ger)
      channels: number        // 2, 6, 8
    }>
    subtitleLanguages?: string[]  // ISO 639-2
    source?: string              // DVD, Blu-ray, UHD Blu-ray
  }
  discNumber?: number
  setName?: string
  setOverview?: string
  edition?: string  // "Director's Cut", "Extended", etc.
  isExtrasDisc?: boolean
}

export interface KodiTVShowParams {
  libraryPath: string
  showName: string
  season: number
  episode: number
  episodeTitle?: string
  sourceFile: string
  metadata?: {
    plot?: string
    aired?: string
    director?: string
    credits?: string
    tmdb_id?: number
    imdb_id?: string
    actors?: Array<{ name: string; role: string; order: number }>
  }
  artwork?: {
    thumb?: string  // episode thumbnail/still
  }
  streamDetails?: KodiMovieParams['streamDetails']
}

export interface KodiShowNFOParams {
  libraryPath: string
  showName: string
  year?: number
  metadata?: {
    plot?: string
    genres?: string[]
    mpaa?: string
    studio?: string
    premiered?: string
    status?: string
    tmdb_id?: number
    imdb_id?: string
    tvdb_id?: number
    actors?: Array<{ name: string; role: string; order: number; thumb?: string }>
  }
  artwork?: {
    poster?: string
    fanart?: string
    banner?: string
    clearlogo?: string
    clearart?: string
    landscape?: string
  }
  seasonArtwork?: Record<number, { poster?: string; fanart?: string; banner?: string }>
}

// ─── Extras folder mapping (Plex + Jellyfin + Kodi compatible) ─────────

export const EXTRAS_FOLDER_MAP: Record<string, string> = {
  behindthescenes: 'Behind The Scenes',
  deleted: 'Deleted Scenes',
  featurette: 'Featurettes',
  interview: 'Interviews',
  scene: 'Scenes',
  short: 'Shorts',
  trailer: 'Trailers',
  other: 'Other'
}

// ─── Service ───────────────────────────────────────────────────────────

export class KodiOutputService {

  /**
   * Compute the Kodi directory and video file path WITHOUT creating anything.
   * Call this before encoding to know where FFmpeg should write its output.
   */
  buildMoviePath(params: {
    libraryPath: string; title: string; year: number
    edition?: string; soundVersion?: string; discNumber?: number; totalDiscs?: number; isExtrasDisc?: boolean
  }): { outputDir: string; videoPath: string } {
    const { libraryPath, title, year, edition, soundVersion, discNumber, totalDiscs, isExtrasDisc } = params
    const folderName = `${title} (${year})`
    const outputDir = join(libraryPath, 'Movies', folderName)

    if (isExtrasDisc) {
      const extrasDir = join(outputDir, 'Extras')
      const fileName = edition ? `${edition}.mkv` : 'Extras.mkv'
      return { outputDir: extrasDir, videoPath: join(extrasDir, fileName) }
    }

    let fileName = folderName
    if (edition) fileName += ` {edition-${edition}}`
    if (soundVersion) fileName += ` - ${soundVersion}`
    if (discNumber && totalDiscs && totalDiscs > 1) fileName += ` - disc${discNumber}`
    return { outputDir, videoPath: join(outputDir, `${fileName}.mkv`) }
  }

  /**
   * Write NFO, copy artwork, and create Extras/ folder.
   * Called AFTER the video file has been written to videoPath by FFmpeg.
   */
  finalizeMovie(params: KodiMovieParams & { videoAlreadyAtPath: string; soundVersion?: string; totalDiscs?: number }): { nfoPath: string } {
    const { libraryPath, title, year, artwork, edition, isExtrasDisc, videoAlreadyAtPath, discNumber } = params
    const soundVersion = (params as { soundVersion?: string }).soundVersion
    const totalDiscs = (params as { totalDiscs?: number }).totalDiscs
    const folderName = `${title} (${year})`
    const outputDir = join(libraryPath, 'Movies', folderName)

    // For extras disc, no NFO needed
    if (isExtrasDisc) {
      log.info(`Finalized extras disc at: ${videoAlreadyAtPath}`)
      return { nfoPath: '' }
    }

    // Ensure directory exists
    mkdirSync(outputDir, { recursive: true })

    // Generate NFO (named to match video file)
    let nfoBaseName = folderName
    if (edition) nfoBaseName += ` {edition-${edition}}`
    if (soundVersion) nfoBaseName += ` - ${soundVersion}`
    if (discNumber && totalDiscs && totalDiscs > 1) nfoBaseName += ` - disc${discNumber}`
    const nfoPath = join(outputDir, `${nfoBaseName}.nfo`)
    writeFileSync(nfoPath, this.generateMovieNFO(params), 'utf-8')

    // Copy artwork using Kodi short-name convention
    if (artwork) {
      this.copyArtworkIfMissing(outputDir, artwork.poster, 'poster.jpg')
      this.copyArtworkIfMissing(outputDir, artwork.fanart, 'fanart.jpg')
      this.copyArtworkIfMissing(outputDir, artwork.banner, 'banner.jpg')
      this.copyArtworkIfMissing(outputDir, artwork.clearlogo, 'clearlogo.png')
      this.copyArtworkIfMissing(outputDir, artwork.clearart, 'clearart.png')
      this.copyArtworkIfMissing(outputDir, artwork.landscape, 'landscape.jpg')
      this.copyArtworkIfMissing(outputDir, artwork.discart, 'discart.png')
      this.copyArtworkIfMissing(outputDir, artwork.keyart, 'keyart.jpg')
    }

    log.info(`Finalized movie at: ${outputDir} (NFO: ${nfoPath})`)
    return { nfoPath }
  }

  exportMovie(params: KodiMovieParams & { soundVersion?: string; totalDiscs?: number }): { outputDir: string; nfoPath: string; moviePath: string } {
    const { libraryPath, title, year, sourceFile, artwork, edition, isExtrasDisc, discNumber } = params
    const soundVersion = (params as { soundVersion?: string }).soundVersion
    const totalDiscs = (params as { totalDiscs?: number }).totalDiscs

    // Folder is always "Movies/Title (Year)/" — no edition in folder name
    // This groups all versions under one Kodi library entry
    const folderName = `${title} (${year})`
    const outputDir = join(libraryPath, 'Movies', folderName)
    mkdirSync(outputDir, { recursive: true })

    const ext = extname(sourceFile) || '.mkv'

    // Extras disc: route to Extras/ subfolder with descriptive name
    if (isExtrasDisc) {
      const extrasDir = join(outputDir, 'Extras')
      mkdirSync(extrasDir, { recursive: true })
      const extrasName = edition ? `${edition}${ext}` : `Extras${ext}`
      const moviePath = join(extrasDir, extrasName)
      copyFileSync(sourceFile, moviePath)
      log.info(`Exported extras disc to: ${extrasDir}`)
      return { outputDir: extrasDir, nfoPath: '', moviePath }
    }

    // Build filename: "Title (Year) {edition-Director's Cut} - DTS-HD Master Audio - disc2.mkv"
    let fileName = folderName
    if (edition) fileName += ` {edition-${edition}}`
    if (soundVersion) fileName += ` - ${soundVersion}`
    if (discNumber && totalDiscs && totalDiscs > 1) fileName += ` - disc${discNumber}`

    const moviePath = join(outputDir, `${fileName}${ext}`)
    copyFileSync(sourceFile, moviePath)

    // Generate NFO (named to match video file)
    const nfoPath = join(outputDir, `${fileName}.nfo`)
    writeFileSync(nfoPath, this.generateMovieNFO(params), 'utf-8')

    // Copy artwork using Kodi short-name convention (only if not already present)
    if (artwork) {
      this.copyArtworkIfMissing(outputDir, artwork.poster, 'poster.jpg')
      this.copyArtworkIfMissing(outputDir, artwork.fanart, 'fanart.jpg')
      this.copyArtworkIfMissing(outputDir, artwork.banner, 'banner.jpg')
      this.copyArtworkIfMissing(outputDir, artwork.clearlogo, 'clearlogo.png')
      this.copyArtworkIfMissing(outputDir, artwork.clearart, 'clearart.png')
      this.copyArtworkIfMissing(outputDir, artwork.landscape, 'landscape.jpg')
      this.copyArtworkIfMissing(outputDir, artwork.discart, 'discart.png')
      this.copyArtworkIfMissing(outputDir, artwork.keyart, 'keyart.jpg')
    }

    log.info(`Exported movie to: ${outputDir}`)
    return { outputDir, nfoPath, moviePath }
  }

  exportTVShow(params: KodiShowNFOParams): { showDir: string; nfoPath: string } {
    const { libraryPath, showName, year, artwork, seasonArtwork } = params

    const showFolder = year ? `${showName} (${year})` : showName
    const showDir = join(libraryPath, 'TV Shows', showFolder)
    mkdirSync(showDir, { recursive: true })

    // Generate tvshow.nfo
    const nfoPath = join(showDir, 'tvshow.nfo')
    writeFileSync(nfoPath, this.generateShowNFO(params), 'utf-8')

    // Copy show-level artwork
    if (artwork) {
      this.copyArtwork(showDir, artwork.poster, 'poster.jpg')
      this.copyArtwork(showDir, artwork.fanart, 'fanart.jpg')
      this.copyArtwork(showDir, artwork.banner, 'banner.jpg')
      this.copyArtwork(showDir, artwork.clearlogo, 'clearlogo.png')
      this.copyArtwork(showDir, artwork.clearart, 'clearart.png')
      this.copyArtwork(showDir, artwork.landscape, 'landscape.jpg')
    }

    // Copy season artwork (named seasonNN-poster.jpg etc.)
    if (seasonArtwork) {
      for (const [seasonNum, art] of Object.entries(seasonArtwork)) {
        const pad = String(seasonNum).padStart(2, '0')
        this.copyArtwork(showDir, art.poster, `season${pad}-poster.jpg`)
        this.copyArtwork(showDir, art.fanart, `season${pad}-fanart.jpg`)
        this.copyArtwork(showDir, art.banner, `season${pad}-banner.jpg`)
      }
    }

    log.info(`Exported TV show NFO to: ${showDir}`)
    return { showDir, nfoPath }
  }

  exportTVEpisode(params: KodiTVShowParams): { outputDir: string; nfoPath: string; episodePath: string } {
    const { libraryPath, showName, season, episode, episodeTitle, sourceFile, artwork, streamDetails } = params

    const showDir = join(libraryPath, 'TV Shows', showName)
    const seasonDir = join(showDir, `Season ${String(season).padStart(2, '0')}`)
    mkdirSync(seasonDir, { recursive: true })

    const epCode = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
    const baseName = episodeTitle
      ? `${showName} - ${epCode} - ${episodeTitle}`
      : `${showName} - ${epCode}`

    // Copy episode file
    const ext = extname(sourceFile) || '.mkv'
    const episodePath = join(seasonDir, `${baseName}${ext}`)
    copyFileSync(sourceFile, episodePath)

    // Generate episode NFO
    const nfoPath = join(seasonDir, `${baseName}.nfo`)
    writeFileSync(nfoPath, this.generateEpisodeNFO(params), 'utf-8')

    // Copy episode thumbnail
    if (artwork?.thumb) {
      this.copyArtwork(seasonDir, artwork.thumb, `${baseName}-thumb.jpg`)
    }

    log.info(`Exported TV episode to: ${seasonDir}`)
    return { outputDir: seasonDir, nfoPath, episodePath }
  }

  // ─── NFO Generators ──────────────────────────────────────────────────

  private generateMovieNFO(params: KodiMovieParams): string {
    const { title, year, metadata, streamDetails, setName, setOverview, edition } = params

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<movie>'
    ]

    lines.push(`  <title>${this.esc(title)}</title>`)
    if (metadata?.originalTitle) lines.push(`  <originaltitle>${this.esc(metadata.originalTitle)}</originaltitle>`)
    if (metadata?.sortTitle) lines.push(`  <sorttitle>${this.esc(metadata.sortTitle)}</sorttitle>`)
    lines.push(`  <year>${year}</year>`)

    // Edition tag (Kodi v21+ Omega)
    if (edition) {
      lines.push(`  <edition>${this.esc(edition)}</edition>`)
    }

    // Ratings
    if (metadata?.voteAverage) {
      lines.push('  <ratings>')
      lines.push('    <rating name="themoviedb" max="10" default="true">')
      lines.push(`      <value>${metadata.voteAverage}</value>`)
      if (metadata.voteCount) lines.push(`      <votes>${metadata.voteCount}</votes>`)
      lines.push('    </rating>')
      lines.push('  </ratings>')
    }

    if (metadata?.plot) lines.push(`  <plot>${this.esc(metadata.plot)}</plot>`)
    if (metadata?.tagline) lines.push(`  <tagline>${this.esc(metadata.tagline)}</tagline>`)
    if (metadata?.runtime) lines.push(`  <runtime>${metadata.runtime}</runtime>`)
    if (metadata?.mpaa) lines.push(`  <mpaa>${this.esc(metadata.mpaa)}</mpaa>`)

    // Unique IDs (critical for Kodi scraper matching)
    if (metadata?.imdb_id) lines.push(`  <uniqueid type="imdb" default="true">${this.esc(metadata.imdb_id)}</uniqueid>`)
    if (metadata?.tmdb_id) lines.push(`  <uniqueid type="tmdb">${metadata.tmdb_id}</uniqueid>`)

    // Genres
    if (metadata?.genres) {
      for (const genre of metadata.genres) {
        lines.push(`  <genre>${this.esc(genre)}</genre>`)
      }
    }

    if (metadata?.country) lines.push(`  <country>${this.esc(metadata.country)}</country>`)
    if (metadata?.studio) lines.push(`  <studio>${this.esc(metadata.studio)}</studio>`)
    if (metadata?.premiered) lines.push(`  <premiered>${metadata.premiered}</premiered>`)
    if (metadata?.director) lines.push(`  <director>${this.esc(metadata.director)}</director>`)
    if (metadata?.credits) lines.push(`  <credits>${this.esc(metadata.credits)}</credits>`)

    // Movie set / collection
    if (setName) {
      lines.push('  <set>')
      lines.push(`    <name>${this.esc(setName)}</name>`)
      if (setOverview) lines.push(`    <overview>${this.esc(setOverview)}</overview>`)
      lines.push('  </set>')
    }

    // Cast
    if (metadata?.actors) {
      for (const actor of metadata.actors) {
        lines.push('  <actor>')
        lines.push(`    <name>${this.esc(actor.name)}</name>`)
        lines.push(`    <role>${this.esc(actor.role)}</role>`)
        lines.push(`    <order>${actor.order}</order>`)
        if (actor.thumb) lines.push(`    <thumb>${this.esc(actor.thumb)}</thumb>`)
        lines.push('  </actor>')
      }
    }

    // Stream details (Kodi reads these from NFO for faster library scans)
    if (streamDetails) {
      lines.push('  <fileinfo>')
      lines.push('    <streamdetails>')

      // Video stream
      if (streamDetails.videoCodec) {
        lines.push('      <video>')
        lines.push(`        <codec>${this.esc(streamDetails.videoCodec)}</codec>`)
        if (streamDetails.videoAspect) lines.push(`        <aspect>${streamDetails.videoAspect}</aspect>`)
        if (streamDetails.videoWidth) lines.push(`        <width>${streamDetails.videoWidth}</width>`)
        if (streamDetails.videoHeight) lines.push(`        <height>${streamDetails.videoHeight}</height>`)
        if (streamDetails.videoDuration) lines.push(`        <durationinseconds>${streamDetails.videoDuration}</durationinseconds>`)
        if (streamDetails.hdrType) lines.push(`        <hdrtype>${this.esc(streamDetails.hdrType)}</hdrtype>`)
        lines.push('      </video>')
      }

      // Audio streams
      if (streamDetails.audioTracks) {
        for (const audio of streamDetails.audioTracks) {
          lines.push('      <audio>')
          lines.push(`        <codec>${this.esc(audio.codec)}</codec>`)
          lines.push(`        <language>${this.esc(audio.language)}</language>`)
          lines.push(`        <channels>${audio.channels}</channels>`)
          lines.push('      </audio>')
        }
      }

      // Subtitle streams
      if (streamDetails.subtitleLanguages) {
        for (const lang of streamDetails.subtitleLanguages) {
          lines.push('      <subtitle>')
          lines.push(`        <language>${this.esc(lang)}</language>`)
          lines.push('      </subtitle>')
        }
      }

      // Source tag (DVD, Blu-ray, etc.)
      if (streamDetails.source) {
        lines.push(`      <source>${this.esc(streamDetails.source)}</source>`)
      }

      lines.push('    </streamdetails>')
      lines.push('  </fileinfo>')
    }

    lines.push(`  <dateadded>${new Date().toISOString().slice(0, 19).replace('T', ' ')}</dateadded>`)
    lines.push('</movie>')

    return lines.join('\n') + '\n'
  }

  generateShowNFO(params: KodiShowNFOParams): string {
    const { showName, metadata } = params

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<tvshow>'
    ]

    lines.push(`  <title>${this.esc(showName)}</title>`)
    if (metadata?.plot) lines.push(`  <plot>${this.esc(metadata.plot)}</plot>`)
    if (metadata?.mpaa) lines.push(`  <mpaa>${this.esc(metadata.mpaa)}</mpaa>`)
    if (metadata?.premiered) lines.push(`  <premiered>${metadata.premiered}</premiered>`)
    if (metadata?.status) lines.push(`  <status>${this.esc(metadata.status)}</status>`)
    if (metadata?.studio) lines.push(`  <studio>${this.esc(metadata.studio)}</studio>`)

    if (metadata?.tvdb_id) lines.push(`  <uniqueid type="tvdb" default="true">${metadata.tvdb_id}</uniqueid>`)
    if (metadata?.tmdb_id) lines.push(`  <uniqueid type="tmdb">${metadata.tmdb_id}</uniqueid>`)
    if (metadata?.imdb_id) lines.push(`  <uniqueid type="imdb">${this.esc(metadata.imdb_id)}</uniqueid>`)

    if (metadata?.genres) {
      for (const genre of metadata.genres) {
        lines.push(`  <genre>${this.esc(genre)}</genre>`)
      }
    }

    if (metadata?.actors) {
      for (const actor of metadata.actors) {
        lines.push('  <actor>')
        lines.push(`    <name>${this.esc(actor.name)}</name>`)
        lines.push(`    <role>${this.esc(actor.role)}</role>`)
        lines.push(`    <order>${actor.order}</order>`)
        lines.push('  </actor>')
      }
    }

    lines.push('</tvshow>')
    return lines.join('\n') + '\n'
  }

  private generateEpisodeNFO(params: KodiTVShowParams): string {
    const { showName, season, episode, episodeTitle, metadata, streamDetails } = params

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<episodedetails>'
    ]

    lines.push(`  <title>${this.esc(episodeTitle || `Episode ${episode}`)}</title>`)
    lines.push(`  <showtitle>${this.esc(showName)}</showtitle>`)
    lines.push(`  <season>${season}</season>`)
    lines.push(`  <episode>${episode}</episode>`)

    if (metadata?.plot) lines.push(`  <plot>${this.esc(metadata.plot)}</plot>`)
    if (metadata?.aired) lines.push(`  <aired>${metadata.aired}</aired>`)
    if (metadata?.director) lines.push(`  <director>${this.esc(metadata.director)}</director>`)
    if (metadata?.credits) lines.push(`  <credits>${this.esc(metadata.credits)}</credits>`)
    if (metadata?.tmdb_id) lines.push(`  <uniqueid type="tmdb">${metadata.tmdb_id}</uniqueid>`)
    if (metadata?.imdb_id) lines.push(`  <uniqueid type="imdb">${this.esc(metadata.imdb_id)}</uniqueid>`)

    if (metadata?.actors) {
      for (const actor of metadata.actors) {
        lines.push('  <actor>')
        lines.push(`    <name>${this.esc(actor.name)}</name>`)
        lines.push(`    <role>${this.esc(actor.role)}</role>`)
        lines.push(`    <order>${actor.order}</order>`)
        lines.push('  </actor>')
      }
    }

    // Stream details
    if (streamDetails) {
      lines.push('  <fileinfo>')
      lines.push('    <streamdetails>')
      if (streamDetails.videoCodec) {
        lines.push('      <video>')
        lines.push(`        <codec>${this.esc(streamDetails.videoCodec)}</codec>`)
        if (streamDetails.videoWidth) lines.push(`        <width>${streamDetails.videoWidth}</width>`)
        if (streamDetails.videoHeight) lines.push(`        <height>${streamDetails.videoHeight}</height>`)
        if (streamDetails.videoAspect) lines.push(`        <aspect>${streamDetails.videoAspect}</aspect>`)
        if (streamDetails.videoDuration) lines.push(`        <durationinseconds>${streamDetails.videoDuration}</durationinseconds>`)
        if (streamDetails.hdrType) lines.push(`        <hdrtype>${this.esc(streamDetails.hdrType)}</hdrtype>`)
        lines.push('      </video>')
      }
      if (streamDetails.audioTracks) {
        for (const audio of streamDetails.audioTracks) {
          lines.push('      <audio>')
          lines.push(`        <codec>${this.esc(audio.codec)}</codec>`)
          lines.push(`        <language>${this.esc(audio.language)}</language>`)
          lines.push(`        <channels>${audio.channels}</channels>`)
          lines.push('      </audio>')
        }
      }
      if (streamDetails.subtitleLanguages) {
        for (const lang of streamDetails.subtitleLanguages) {
          lines.push(`      <subtitle><language>${this.esc(lang)}</language></subtitle>`)
        }
      }
      lines.push('    </streamdetails>')
      lines.push('  </fileinfo>')
    }

    lines.push('</episodedetails>')
    return lines.join('\n') + '\n'
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private copyArtwork(destDir: string, sourcePath: string | undefined, destName: string): void {
    if (!sourcePath || !existsSync(sourcePath)) return
    try {
      copyFileSync(sourcePath, join(destDir, destName))
    } catch (err) {
      log.warn(`Failed to copy artwork ${destName}: ${err}`)
    }
  }

  /** Only copy artwork if the destination file doesn't already exist (avoid overwrite across versions) */
  private copyArtworkIfMissing(destDir: string, sourcePath: string | undefined, destName: string): void {
    if (!sourcePath || !existsSync(sourcePath)) return
    const dest = join(destDir, destName)
    if (existsSync(dest)) return // Don't overwrite existing artwork
    this.copyArtwork(destDir, sourcePath, destName)
  }

  private esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}
