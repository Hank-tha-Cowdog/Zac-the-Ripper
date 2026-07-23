import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { writeStatusSnapshot, recordLastError, _setStatusDirForTesting } from './status-snapshot'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ztr-status-test-'))
  _setStatusDirForTesting(dir)
})

afterEach(() => {
  _setStatusDirForTesting(null)
  rmSync(dir, { recursive: true, force: true })
})

function readStatus(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'status.json'), 'utf-8'))
}

describe('writeStatusSnapshot', () => {
  it('writes valid JSON with pid, version, and timestamps', () => {
    writeStatusSnapshot([], '2.5.0-dev')
    const status = readStatus()

    expect(status.pid).toBe(process.pid)
    expect(status.version).toBe('2.5.0-dev')
    expect(status.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(status.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(status.activeJobs).toEqual([])
  })

  it('reflects the active jobs passed in', () => {
    writeStatusSnapshot([
      { jobId: 'abc', dbId: 1, type: 'jellyfin_export', status: 'running', progress: 42, message: 'Encoding...' }
    ], '2.5.0-dev')

    const status = readStatus()
    expect(status.activeJobs).toEqual([
      { jobId: 'abc', dbId: 1, type: 'jellyfin_export', status: 'running', progress: 42, message: 'Encoding...' }
    ])
  })

  it('leaves no leftover .tmp file after a successful write (atomic rename)', () => {
    writeStatusSnapshot([], '2.5.0-dev')
    const files = readdirSync(dir)
    expect(files).toEqual(['status.json'])
  })

  it('overwrites cleanly on repeated calls rather than appending', () => {
    writeStatusSnapshot([{ jobId: 'a', dbId: 1, type: 'mkv_rip', status: 'running' }], '2.5.0-dev')
    writeStatusSnapshot([{ jobId: 'b', dbId: 2, type: 'audio_rip', status: 'running' }], '2.5.0-dev')

    const status = readStatus()
    expect(status.activeJobs).toHaveLength(1)
    expect((status.activeJobs as Array<{ jobId: string }>)[0].jobId).toBe('b')
  })

  it('includes the last recorded error', () => {
    recordLastError('MakeMKV deadlock detected on title 3')
    writeStatusSnapshot([], '2.5.0-dev')

    const status = readStatus()
    expect(status.lastError).toBe('MakeMKV deadlock detected on title 3')
  })

  it('never throws even when the directory cannot be created', () => {
    const blockerFile = join(tmpdir(), `ztr-status-blocker-${Date.now()}`)
    writeFileSync(blockerFile, 'x')
    _setStatusDirForTesting(join(blockerFile, 'impossible', 'nested'))

    expect(() => writeStatusSnapshot([], '2.5.0-dev')).not.toThrow()

    rmSync(blockerFile, { force: true })
  })
})
