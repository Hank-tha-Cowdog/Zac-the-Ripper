import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFileSync } from 'child_process'
import { hasZscaleSupport, _resetZscaleCacheForTesting } from './ffmpeg-capabilities'

vi.mock('child_process', () => ({
  execFileSync: vi.fn()
}))

const mockedExecFileSync = vi.mocked(execFileSync)

beforeEach(() => {
  _resetZscaleCacheForTesting()
  mockedExecFileSync.mockReset()
})

describe('hasZscaleSupport', () => {
  it('returns true when zscale appears in the filter list', () => {
    // Real captured shape (abbreviated) from an ffmpeg build that has it.
    mockedExecFileSync.mockReturnValue(Buffer.from(
      ' T.C zscale           V->V       Apply resize, colorspace and bit depth conversion.\n' +
      ' ..V tonemap          V->V       Conversion to/from different dynamic ranges.\n'
    ))
    expect(hasZscaleSupport('/usr/bin/ffmpeg')).toBe(true)
  })

  it('returns false when zscale is absent — the real state on this machine\'s Homebrew ffmpeg 8.0.1', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from(
      ' ..V tonemap          V->V       Conversion to/from different dynamic ranges.\n'
    ))
    expect(hasZscaleSupport('/opt/homebrew/bin/ffmpeg')).toBe(false)
  })

  it('does not match filter names that merely contain "scale" as a substring', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from(
      ' ..V scale            V->V       Scale the input video size and/or convert the image format.\n' +
      ' ..V hscale           V->V       Some other filter.\n'
    ))
    expect(hasZscaleSupport('/usr/bin/ffmpeg')).toBe(false)
  })

  it('caches the result — only probes the process once', () => {
    mockedExecFileSync.mockReturnValue(Buffer.from(' T.C zscale  V->V  x\n'))
    hasZscaleSupport('/usr/bin/ffmpeg')
    hasZscaleSupport('/usr/bin/ffmpeg')
    hasZscaleSupport('/usr/bin/ffmpeg')
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1)
  })

  it('treats a failed probe (e.g. ffmpeg not found) as unsupported, not a throw', () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error('ENOENT') })
    expect(() => hasZscaleSupport('/nonexistent/ffmpeg')).not.toThrow()
    expect(hasZscaleSupport('/nonexistent/ffmpeg')).toBe(false)
  })
})
