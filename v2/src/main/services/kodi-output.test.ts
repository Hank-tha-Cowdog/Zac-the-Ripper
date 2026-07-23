import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { sanitizeTitle, KodiOutputService } from './kodi-output'

describe('sanitizeTitle', () => {
  it('replaces forward slashes with a hyphen', () => {
    expect(sanitizeTitle('Fahrenheit 9/11')).toBe('Fahrenheit 9-11')
  })

  it('replaces backslashes with a hyphen', () => {
    expect(sanitizeTitle('A\\B')).toBe('A-B')
  })

  it('replaces colons with space-hyphen', () => {
    expect(sanitizeTitle('Star Trek: Deep Space Nine')).toBe('Star Trek - Deep Space Nine')
  })

  it('strips remaining illegal filesystem characters', () => {
    expect(sanitizeTitle('What<Is>This"Movie|Called?*')).toBe('WhatIsThisMovieCalled')
  })

  it('collapses double spaces produced by sanitization', () => {
    expect(sanitizeTitle('Movie:  Subtitle')).toBe('Movie - Subtitle')
  })

  it('leaves an already-safe title untouched', () => {
    expect(sanitizeTitle('Pulp Fiction')).toBe('Pulp Fiction')
  })

  it('trims leading/trailing whitespace produced by substitutions', () => {
    expect(sanitizeTitle('  Best in Show  ')).toBe('Best in Show')
  })
})

describe('buildMoviePath — Plex ID-tag naming', () => {
  const service = new KodiOutputService()

  it('leaves the folder/file name unchanged when no plexIdTag is given (regression guard)', () => {
    const { outputDir, videoPath } = service.buildMoviePath({ libraryPath: '/lib', title: 'Best in Show', year: 2000 })
    expect(outputDir).toBe('/lib/Movies/Best in Show (2000)')
    expect(videoPath).toBe('/lib/Movies/Best in Show (2000)/Best in Show (2000).mkv')
  })

  it('appends the tag to both the folder and file name when plexIdTag is given', () => {
    const { outputDir, videoPath } = service.buildMoviePath({
      libraryPath: '/lib', title: 'Best in Show', year: 2000, plexIdTag: '{tmdb-12345}'
    })
    expect(outputDir).toBe('/lib/Movies/Best in Show (2000) {tmdb-12345}')
    expect(videoPath).toBe('/lib/Movies/Best in Show (2000) {tmdb-12345}/Best in Show (2000) {tmdb-12345}.mkv')
  })

  it('places the plexIdTag before the edition tag in the filename', () => {
    const { videoPath } = service.buildMoviePath({
      libraryPath: '/lib', title: 'Blade Runner', year: 1982, edition: 'Final Cut', plexIdTag: '{tmdb-78}'
    })
    expect(videoPath).toBe('/lib/Movies/Blade Runner (1982) {tmdb-78}/Blade Runner (1982) {tmdb-78} {edition-Final Cut}.mkv')
  })
})

describe('finalizeMovie / buildMoviePath folder-name consistency', () => {
  const service = new KodiOutputService()
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ztr-kodi-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('finalizeMovie writes the NFO into the exact folder buildMoviePath computed, with a plexIdTag', () => {
    const plexIdTag = '{tmdb-999}'
    const { outputDir, videoPath } = service.buildMoviePath({
      libraryPath: dir, title: 'Test Movie', year: 2024, plexIdTag
    })

    service.finalizeMovie({
      libraryPath: dir,
      title: 'Test Movie',
      year: 2024,
      sourceFile: videoPath,
      videoAlreadyAtPath: videoPath,
      plexIdTag
    })

    // If finalizeMovie's independently-computed folder name ever drifts
    // from buildMoviePath's, the NFO lands in a sibling folder instead of
    // next to the video file it describes — this catches that directly.
    expect(existsSync(outputDir)).toBe(true)
    const nfoPath = videoPath.replace(/\.mkv$/, '.nfo')
    expect(existsSync(nfoPath)).toBe(true)
  })
})

describe('exportTVShow — .plexmatch generation', () => {
  const service = new KodiOutputService()
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ztr-plexmatch-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes .plexmatch only when isPlexTarget is true', () => {
    const { showDir } = service.exportTVShow({
      libraryPath: dir, showName: 'Test Show', year: 2020, isPlexTarget: true
    })
    expect(existsSync(join(showDir, '.plexmatch'))).toBe(true)
  })

  it('does not write .plexmatch for a Kodi/Jellyfin target', () => {
    const { showDir } = service.exportTVShow({
      libraryPath: dir, showName: 'Test Show', year: 2020, isPlexTarget: false
    })
    expect(existsSync(join(showDir, '.plexmatch'))).toBe(false)
  })

  it('formats .plexmatch as verified line-delimited key: value pairs, with all available IDs', () => {
    const { showDir } = service.exportTVShow({
      libraryPath: dir, showName: 'Attack on Titan', year: 2013,
      metadata: { tvdb_id: 267440, tmdb_id: 1429, imdb_id: 'tt2560140' },
      isPlexTarget: true
    })
    const content = readFileSync(join(showDir, '.plexmatch'), 'utf-8')
    expect(content).toBe(
      'title: Attack on Titan\n' +
      'year: 2013\n' +
      'tvdbid: 267440\n' +
      'tmdbid: 1429\n' +
      'imdbid: tt2560140\n'
    )
  })

  it('omits ID lines that are unavailable rather than writing empty values', () => {
    const { showDir } = service.exportTVShow({
      libraryPath: dir, showName: 'Unmatched Show', year: 2022, isPlexTarget: true
    })
    const content = readFileSync(join(showDir, '.plexmatch'), 'utf-8')
    expect(content).toBe('title: Unmatched Show\nyear: 2022\n')
  })
})
