import type { DiscInfo } from './disc-detection'

export type DiscFreshnessResult = { valid: true } | { valid: false; error: string }

/**
 * Verifies a submitted rip request's track selection still applies to
 * whatever is actually in the drive right now.
 *
 * The renderer's track selection is only ever valid for the disc it was
 * made against. Between that selection and the rip actually starting, the
 * user can eject and swap discs (stale UI state, a slow click, ejecting a
 * different drive) — without this check, the rip would proceed using the
 * OLD title IDs against whatever's physically in the drive now: MakeMKV
 * extracts whatever title numbers those IDs happen to mean on the NEW
 * disc, silently mislabeled with a mix of fresh-disc DB metadata and
 * stale-selection encoding decisions.
 */
export function validateDiscFreshness(params: {
  isIngest?: boolean
  discInfo: DiscInfo | null
  expectedDiscId?: string
  titleIds: number[]
}): DiscFreshnessResult {
  // Ingest mode processes local files the user picked directly — there's
  // no physical disc to have changed underneath the selection.
  if (params.isIngest) return { valid: true }

  if (!params.discInfo) {
    return { valid: false, error: 'No disc detected in the drive — it may have been ejected. Rescan and try again.' }
  }

  if (params.expectedDiscId && params.discInfo.discId !== params.expectedDiscId) {
    return { valid: false, error: 'The disc in the drive has changed since you selected tracks. Rescan and try again before ripping.' }
  }

  const validTitleIds = new Set(params.discInfo.tracks.map(t => t.id))
  const unknownTitleIds = params.titleIds.filter(id => !validTitleIds.has(id))
  if (unknownTitleIds.length > 0) {
    return { valid: false, error: `Selected track(s) [${unknownTitleIds.join(', ')}] don't exist on the current disc — rescan and re-select before ripping.` }
  }

  return { valid: true }
}
