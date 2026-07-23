import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { logEvent, _setEventLogDirForTesting } from './event-log'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ztr-event-log-test-'))
  _setEventLogDirForTesting(dir)
})

afterEach(() => {
  _setEventLogDirForTesting(null)
  rmSync(dir, { recursive: true, force: true })
})

function readEvents(): Array<Record<string, unknown>> {
  const content = readFileSync(join(dir, 'events.jsonl'), 'utf-8')
  return content.trim().split('\n').map(line => JSON.parse(line))
}

describe('logEvent', () => {
  it('writes one valid JSON object per line', () => {
    logEvent('app_start', { pid: 1234 })
    logEvent('job_created', { jobId: 'abc-123', dbId: 5 })

    const events = readEvents()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ event: 'app_start', pid: 1234 })
    expect(events[1]).toMatchObject({ event: 'job_created', jobId: 'abc-123', dbId: 5 })
  })

  it('includes an ISO timestamp on every event', () => {
    logEvent('heartbeat')
    const [event] = readEvents()
    expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('preserves insertion order across many events', () => {
    for (let i = 0; i < 20; i++) {
      logEvent('progress', { i })
    }
    const events = readEvents()
    expect(events.map(e => e.i)).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('works with no data payload', () => {
    expect(() => logEvent('app_quit')).not.toThrow()
    const [event] = readEvents()
    expect(event.event).toBe('app_quit')
  })

  it('never throws, even with cyclic or unusual data', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    expect(() => logEvent('crash', { err: cyclic })).not.toThrow()
  })
})
