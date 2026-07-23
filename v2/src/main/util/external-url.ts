/**
 * Domains this app has a legitimate reason to open in the user's browser.
 * Currently just the MakeMKV download link (MakeMKVSetupScreen.tsx) plus
 * the metadata providers the app already talks to server-side (TMDB,
 * MusicBrainz, Cover Art Archive) as headroom for a future "View on
 * TMDB"-style link — there is no open-ended external-link feature today.
 */
const ALLOWED_EXTERNAL_HOSTS = [
  'www.makemkv.com',
  'makemkv.com',
  'www.themoviedb.org',
  'themoviedb.org',
  'musicbrainz.org',
  'coverartarchive.org'
]

/**
 * Without an allowlist, shell.openExternal(url) hands ANY url a renderer
 * (or a compromised/malicious page loaded via a window-open attempt) asks
 * for straight to the OS's default handler — an `https:` link is a
 * legitimate "open my browser" case, but `file:`, `javascript:`, or a
 * registered custom protocol could do a lot more than open a browser tab.
 * This is the standard Electron hardening advice for setWindowOpenHandler.
 */
export function isAllowedExternalUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  return ALLOWED_EXTERNAL_HOSTS.includes(url.hostname.toLowerCase())
}
