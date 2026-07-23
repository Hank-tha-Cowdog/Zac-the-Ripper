import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'fs'
import { RotatingFile } from './rotating-file'

const dirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ztr-rotating-file-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup between tests
    }
  }
})

describe('RotatingFile', () => {
  it('creates the directory and file on first append', () => {
    const dir = join(makeTempDir(), 'nested', 'logs')
    const file = new RotatingFile(dir, 'test.log')
    file.append('hello')

    expect(existsSync(join(dir, 'test.log'))).toBe(true)
    expect(readFileSync(join(dir, 'test.log'), 'utf-8')).toBe('hello\n')
  })

  it('appends multiple lines in order', () => {
    const dir = makeTempDir()
    const file = new RotatingFile(dir, 'test.log')
    file.append('line 1')
    file.append('line 2')
    file.append('line 3')

    const content = readFileSync(join(dir, 'test.log'), 'utf-8')
    expect(content).toBe('line 1\nline 2\nline 3\n')
  })

  it('rotates to .1 once the size threshold is exceeded', () => {
    const dir = makeTempDir()
    // Threshold smaller than the first line (40 chars + newline = 41 bytes),
    // so the second append's pre-write size check sees it's already over.
    const file = new RotatingFile(dir, 'test.log', 30)

    file.append('a'.repeat(40))
    expect(existsSync(join(dir, 'test.log.1'))).toBe(false)

    // This append starts by checking the *current* file size (already over
    // the 30-byte threshold from the first line), so it rotates before writing.
    file.append('b'.repeat(10))

    expect(existsSync(join(dir, 'test.log.1'))).toBe(true)
    expect(readFileSync(join(dir, 'test.log.1'), 'utf-8')).toBe('a'.repeat(40) + '\n')
    expect(readFileSync(join(dir, 'test.log'), 'utf-8')).toBe('b'.repeat(10) + '\n')
  })

  it('overwrites the previous .1 rather than accumulating forever', () => {
    const dir = makeTempDir()
    const file = new RotatingFile(dir, 'test.log', 20)

    file.append('first-batch-of-text-over-20-bytes')
    file.append('second-batch-triggers-rotation')
    file.append('third-batch-triggers-another-rotation')

    // Only ever a current file + one rotated backup — no test.log.2, .3, etc.
    expect(existsSync(join(dir, 'test.log.2'))).toBe(false)
    expect(existsSync(join(dir, 'test.log.1'))).toBe(true)
  })

  it('never throws even if the append fails', () => {
    // Point at a path that can't be created (parent is actually a file, not a dir)
    const dir = makeTempDir()
    const blockerFile = join(dir, 'blocker')
    new RotatingFile(dir, 'test.log').append('setup') // ensure dir exists first
    writeFileSync(blockerFile, 'x')

    const file = new RotatingFile(join(blockerFile, 'impossible'), 'test.log')
    expect(() => file.append('should not throw')).not.toThrow()
  })
})
