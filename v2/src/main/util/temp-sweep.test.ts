import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { sweepStaleTempFiles } from './temp-sweep'

const createdPaths: string[] = []

function makeStaleDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'partial.mkv'), 'fake staged video data')
  createdPaths.push(dir)
  return dir
}

function makeUnrelatedFile(name: string): string {
  const path = join(tmpdir(), name)
  writeFileSync(path, 'not ours — must survive the sweep')
  createdPaths.push(path)
  return path
}

afterEach(() => {
  for (const p of createdPaths.splice(0)) {
    try {
      rmSync(p, { recursive: true, force: true })
    } catch {
      // Already removed by the sweep itself — fine
    }
  }
})

describe('sweepStaleTempFiles', () => {
  it('removes every known ztr_ temp prefix', () => {
    const stage = makeStaleDir('ztr_stage_')
    const music = makeStaleDir('ztr_music_')
    const poster = makeStaleDir('ztr_poster_')
    const fanart = makeStaleDir('ztr_fanart_')

    sweepStaleTempFiles()

    expect(existsSync(stage)).toBe(false)
    expect(existsSync(music)).toBe(false)
    expect(existsSync(poster)).toBe(false)
    expect(existsSync(fanart)).toBe(false)
  })

  it('never touches files/dirs outside the known ztr_ prefixes', () => {
    const unrelatedFile = makeUnrelatedFile(`not-ztr-related-${Date.now()}.txt`)
    const unrelatedDir = makeStaleDir('some_other_apps_temp_')

    sweepStaleTempFiles()

    expect(existsSync(unrelatedFile)).toBe(true)
    expect(existsSync(unrelatedDir)).toBe(true)
  })

  it('does not throw when there is nothing to sweep', () => {
    expect(() => sweepStaleTempFiles()).not.toThrow()
  })
})
