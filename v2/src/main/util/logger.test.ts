import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger, setLogLevel, getLogLevel } from './logger'

describe('logger', () => {
  const originalLevel = getLogLevel()

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    setLogLevel(originalLevel)
    vi.restoreAllMocks()
  })

  it('logs at or above the current level', () => {
    setLogLevel('warn')
    const log = createLogger('test-module')

    log.debug('should be filtered out')
    log.info('should also be filtered out')
    log.warn('should appear')
    log.error('should appear')

    expect(console.debug).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('logs everything at debug level', () => {
    setLogLevel('debug')
    const log = createLogger('test-module')

    log.debug('a')
    log.info('b')
    log.warn('c')
    log.error('d')

    expect(console.debug).toHaveBeenCalledTimes(1)
    expect(console.log).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('includes module name, level, and timestamp in the formatted line', () => {
    setLogLevel('info')
    const log = createLogger('makemkv')
    log.info('rip started')

    const [line] = vi.mocked(console.log).mock.calls[0]
    expect(line).toContain('[makemkv]')
    expect(line).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(line).toContain('[INFO]')
    expect(line).toContain('rip started')
  })

  it('serializes trailing Error args using their stack/message, not [object Object]', () => {
    setLogLevel('info')
    const log = createLogger('test-module')
    const err = new Error('disc read failed')

    log.error('rip failed', err)

    const [line] = vi.mocked(console.error).mock.calls[0]
    expect(line).toContain('disc read failed')
    expect(line).not.toContain('[object Object]')
  })

  it('serializes plain object args as JSON', () => {
    setLogLevel('info')
    const log = createLogger('test-module')

    log.info('progress', { percentage: 42, jobId: 'abc-123' })

    const [line] = vi.mocked(console.log).mock.calls[0]
    expect(line).toContain('"percentage":42')
    expect(line).toContain('"jobId":"abc-123"')
  })

  it('setLogLevel/getLogLevel round-trip', () => {
    setLogLevel('error')
    expect(getLogLevel()).toBe('error')
    setLogLevel('debug')
    expect(getLogLevel()).toBe('debug')
  })
})
