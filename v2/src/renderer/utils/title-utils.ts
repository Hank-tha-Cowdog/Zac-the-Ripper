const MINOR_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  'in', 'on', 'at', 'to', 'of', 'by', 'up', 'as', 'is', 'if', 'it',
  'vs', 'via', 'de', 'du', 'le', 'la', 'et'
])

/**
 * Converts raw disc titles like "THE_DARK_KNIGHT" → "The Dark Knight"
 * - Replaces underscores with spaces
 * - Strips disc suffixes (D1, Disc 2, Disk1, CD1, etc.)
 * - Applies title case with minor word handling
 */
export function cleanDiscTitle(raw: string): string {
  if (!raw) return ''

  let title = raw
    .replace(/_/g, ' ')
    .trim()

  // Strip trailing disc-number suffixes: D1, D2, Disc 1, Disc1, Disk 1, CD1, etc.
  title = title
    .replace(/\s*\b(?:D|Disc|Disk|CD)\s*\d+\s*$/i, '')
    .trim()

  if (!title) return ''

  return title
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (i === 0 || !MINOR_WORDS.has(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1)
      }
      return word
    })
    .join(' ')
}

/**
 * Expand abbreviated magnitude suffixes in a word.
 * "20k" → "20000", "5m" → "5000000"
 */
function expandMagnitude(word: string): string | null {
  const m = word.match(/^(\d+)([km])$/i)
  if (!m) return null
  const num = parseInt(m[1], 10)
  const suffix = m[2].toLowerCase()
  if (suffix === 'k') return String(num * 1000)
  if (suffix === 'm') return String(num * 1000000)
  return null
}

/**
 * Generates multiple TMDB search query variants from a raw disc title.
 * Handles abbreviations like "20KLEAGUES" → ["20000 Leagues", "20k Leagues", "20 Kleagues"]
 * Returns an array of queries to try in order (most likely match first).
 */
export function generateTmdbQueries(raw: string): string[] {
  const cleaned = cleanDiscTitle(raw)
  if (!cleaned) return []

  const queries: string[] = []
  const seen = new Set<string>()

  const add = (q: string) => {
    const norm = q.trim()
    if (norm && !seen.has(norm.toLowerCase())) {
      seen.add(norm.toLowerCase())
      queries.push(norm)
    }
  }

  // 1. Standard cleaned title
  add(cleaned)

  // 2. Expand magnitude suffixes (20k → 20000) within each word
  const words = cleaned.split(/\s+/)
  const expanded = words.map((w) => {
    const exp = expandMagnitude(w)
    return exp !== null ? exp : w
  })
  add(expanded.join(' '))

  // 3. Split digit-letter boundaries: "20kleagues" → "20k Leagues" → "20000 Leagues"
  const splitWords = words.map((w) => {
    // Insert space at digit→letter boundary: "20kleagues" → "20k leagues"
    return w.replace(/(\d)([a-zA-Z])/g, '$1 $2')
  })
  const splitTitle = splitWords.join(' ')
  // Re-clean for title case
  const recleanedSplit = splitTitle
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (i === 0 || !MINOR_WORDS.has(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1)
      }
      return word
    })
    .join(' ')
  add(recleanedSplit)

  // 4. Split + expand magnitude: "20k leagues" → "20000 Leagues"
  const splitAndExpanded = splitTitle
    .split(/\s+/)
    .map((w) => {
      const exp = expandMagnitude(w)
      return exp !== null ? exp : w
    })
  const splitExpandedTitle = splitAndExpanded
    .map((word, i) => {
      const lower = word.toLowerCase()
      if (/^\d+$/.test(word)) return word
      if (i === 0 || !MINOR_WORDS.has(lower)) {
        return lower.charAt(0).toUpperCase() + lower.slice(1)
      }
      return lower
    })
    .join(' ')
  add(splitExpandedTitle)

  return queries
}
