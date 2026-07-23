import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { validateWavFile, CD_BYTES_PER_SECTOR } from './wav-validate'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ztr-wav-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeWavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(2, 22) // stereo
  header.writeUInt32LE(44100, 24)
  header.writeUInt32LE(176400, 28)
  header.writeUInt16LE(4, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}

describe('validateWavFile', () => {
  it('accepts a real-sized WAV file matching its expected track sector length', () => {
    const sectors = 100
    const dataBytes = sectors * CD_BYTES_PER_SECTOR
    const path = join(dir, 'track.wav')
    writeFileSync(path, Buffer.concat([makeWavHeader(dataBytes), Buffer.alloc(dataBytes)]))

    const result = validateWavFile(path, sectors)
    expect(result.valid).toBe(true)
  })

  it('rejects a missing file', () => {
    const result = validateWavFile(join(dir, 'nonexistent.wav'), 100)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('does not exist')
  })

  it('rejects an empty (zero-byte) file — the exact shape of a cdparanoia exit(0)-but-skipped track', () => {
    const path = join(dir, 'empty.wav')
    writeFileSync(path, Buffer.alloc(0))
    const result = validateWavFile(path, 100)
    expect(result.valid).toBe(false)
  })

  it('rejects a file with a corrupt/missing RIFF header', () => {
    const path = join(dir, 'corrupt.wav')
    writeFileSync(path, Buffer.alloc(1000, 0)) // all zeros, no RIFF/WAVE magic
    const result = validateWavFile(path, 100)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('not a valid WAV file')
  })

  it('rejects a truncated file (valid header, far too little audio data)', () => {
    const sectors = 1000 // expects ~2.35MB of audio
    const path = join(dir, 'truncated.wav')
    const tinyDataBytes = 500 // actually has ~0.5KB — a dropped-connection-style truncation
    writeFileSync(path, Buffer.concat([makeWavHeader(tinyDataBytes), Buffer.alloc(tinyDataBytes)]))

    const result = validateWavFile(path, sectors)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('far shorter than expected')
  })

  it('tolerates a small (<5%) shortfall from the expected byte count', () => {
    const sectors = 1000
    const expectedBytes = sectors * CD_BYTES_PER_SECTOR
    const slightlyShort = Math.floor(expectedBytes * 0.97) // within the 95% tolerance
    const path = join(dir, 'slightly-short.wav')
    writeFileSync(path, Buffer.concat([makeWavHeader(slightlyShort), Buffer.alloc(slightlyShort)]))

    const result = validateWavFile(path, sectors)
    expect(result.valid).toBe(true)
  })
})
