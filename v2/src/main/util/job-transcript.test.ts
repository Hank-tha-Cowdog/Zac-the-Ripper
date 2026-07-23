import { describe, it, expect } from 'vitest'
import { getJobTranscriptPath } from './job-transcript'

describe('getJobTranscriptPath', () => {
  it('shortens the jobId to a readable 8-character prefix', () => {
    const path = getJobTranscriptPath('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'makemkv')
    expect(path).toContain('a1b2c3d4-makemkv.log')
    expect(path).not.toContain('e5f6-7890')
  })

  it('nests transcripts under a jobs/ subdirectory of the log dir', () => {
    const path = getJobTranscriptPath('abcd1234-xxxx', 'ffmpeg')
    expect(path).toMatch(/jobs[\\/]abcd1234-ffmpeg\.log$/)
  })

  it('produces distinct paths for different tools on the same job', () => {
    const jobId = 'abcd1234-xxxx'
    expect(getJobTranscriptPath(jobId, 'makemkv')).not.toBe(getJobTranscriptPath(jobId, 'ffmpeg'))
  })
})
