import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

interface FakeRequest extends EventEmitter {
  end: () => void
  abort: () => void
}

// Requests that never call end()'s microtask — simulates a hung connection
// (bad network/VPN/firewall) that never emits 'response' or 'error'.
let nextBehavior: 'hang' | { statusCode: number; body: string } = 'hang'
let abortedCount = 0
const settingsStore: Record<string, string> = {}

vi.mock('electron', () => ({
  net: {
    request: vi.fn(() => {
      const req = new EventEmitter() as FakeRequest
      req.abort = () => { abortedCount++ }
      req.end = () => {
        if (nextBehavior === 'hang') return // never emits anything
        const behavior = nextBehavior
        queueMicrotask(() => {
          const res = new EventEmitter() as EventEmitter
          req.emit('response', res)
          queueMicrotask(() => {
            res.emit('data', Buffer.from(behavior.body))
            res.emit('end')
          })
        })
      }
      return req
    })
  }
}))

vi.mock('../database/queries/settings', () => ({
  getSetting: (key: string) => settingsStore[key]
}))

import { TMDBService } from './tmdb'

beforeEach(() => {
  nextBehavior = 'hang'
  abortedCount = 0
  settingsStore['kodi.tmdb_api_key'] = 'test-key'
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TMDBService request timeout', () => {
  it('rejects a hung search request instead of waiting forever', async () => {
    const service = new TMDBService()
    const promise = service.search('some query')
    await vi.advanceTimersByTimeAsync(20000)
    // search() catches the rejection internally and resolves to [] — the
    // important thing is that it resolves AT ALL within the timeout window.
    await expect(promise).resolves.toEqual([])
  })

  it('aborts the underlying request on timeout', async () => {
    const service = new TMDBService()
    const promise = service.getDetails(123, 'movie')
    await vi.advanceTimersByTimeAsync(20000)
    await promise
    expect(abortedCount).toBe(1)
  })

  it('does not time out a request that resolves promptly', async () => {
    nextBehavior = { statusCode: 200, body: JSON.stringify({ id: 42, title: 'Real Movie', overview: '' }) }
    const service = new TMDBService()
    const promise = service.getDetails(42, 'movie')
    await vi.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result?.id).toBe(42)
    expect(abortedCount).toBe(0)
  })

  it('getDetails resolves to null (not a hang) when the request times out', async () => {
    const service = new TMDBService()
    const promise = service.getDetails(123, 'movie')
    await vi.advanceTimersByTimeAsync(20000)
    await expect(promise).resolves.toBeNull()
  })
})
