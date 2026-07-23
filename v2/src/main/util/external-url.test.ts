import { describe, it, expect } from 'vitest'
import { isAllowedExternalUrl } from './external-url'

describe('isAllowedExternalUrl', () => {
  it('allows the MakeMKV download page (the one real link in the app today)', () => {
    expect(isAllowedExternalUrl('https://www.makemkv.com/download/')).toBe(true)
  })

  it('allows the bare (non-www) allowlisted domains', () => {
    expect(isAllowedExternalUrl('https://themoviedb.org/movie/123')).toBe(true)
    expect(isAllowedExternalUrl('https://musicbrainz.org/release/abc')).toBe(true)
    expect(isAllowedExternalUrl('https://coverartarchive.org/release/abc/front')).toBe(true)
  })

  it('rejects a domain that is not on the allowlist', () => {
    expect(isAllowedExternalUrl('https://evil.example.com/')).toBe(false)
  })

  it('rejects non-https protocols even for an allowlisted host', () => {
    expect(isAllowedExternalUrl('http://www.makemkv.com/download/')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects a lookalike host that merely contains an allowlisted domain as a substring', () => {
    // The classic bypass attempt: "makemkv.com.evil.com" or "evilmakemkv.com"
    expect(isAllowedExternalUrl('https://www.makemkv.com.evil.com/')).toBe(false)
    expect(isAllowedExternalUrl('https://notmakemkv.com/')).toBe(false)
  })

  it('rejects a URL using userinfo to visually disguise the real host', () => {
    // https://www.makemkv.com@evil.com/ — browsers/URL parse the host as evil.com
    expect(isAllowedExternalUrl('https://www.makemkv.com@evil.com/')).toBe(false)
  })

  it('returns false (not a throw) for a malformed URL', () => {
    expect(() => isAllowedExternalUrl('not a url')).not.toThrow()
    expect(isAllowedExternalUrl('not a url')).toBe(false)
  })

  it('is case-insensitive on the hostname', () => {
    expect(isAllowedExternalUrl('https://WWW.MAKEMKV.COM/download/')).toBe(true)
  })
})
