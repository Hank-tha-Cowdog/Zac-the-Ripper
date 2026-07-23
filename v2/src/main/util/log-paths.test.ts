import { describe, it, expect, afterEach } from 'vitest'
import { getLogDir } from './log-paths'

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform })
}

afterEach(() => {
  setPlatform(originalPlatform)
})

describe('getLogDir', () => {
  it('resolves to ~/Library/Logs/Zac the Ripper on macOS', () => {
    setPlatform('darwin')
    expect(getLogDir()).toMatch(/Library\/Logs\/Zac the Ripper$/)
  })

  it('resolves under APPDATA on Windows', () => {
    setPlatform('win32')
    expect(getLogDir()).toMatch(/Zac the Ripper[\\/]logs$/)
  })

  it('resolves under XDG_STATE_HOME (or ~/.local/state) on Linux', () => {
    setPlatform('linux')
    expect(getLogDir()).toMatch(/zac-the-ripper\/logs$/)
  })

  it('never throws regardless of platform', () => {
    for (const platform of ['darwin', 'win32', 'linux', 'freebsd'] as NodeJS.Platform[]) {
      setPlatform(platform)
      expect(() => getLogDir()).not.toThrow()
    }
  })
})
