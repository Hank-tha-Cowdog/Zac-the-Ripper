/**
 * Sanitize a music artist/album/track name for use as a filesystem path segment.
 * Strips characters illegal on macOS/Windows/Linux and leading/trailing dots —
 * a name that starts with a dot (e.g. ".38 Special") would otherwise produce a
 * hidden dotfile/dotdir that Navidrome's library scanner silently skips.
 */
export function sanitizeMusicFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim() || 'Unknown'
}
