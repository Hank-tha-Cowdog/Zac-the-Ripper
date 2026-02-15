import { useEffect, useCallback, useRef } from 'react'
import { useDiscStore } from '../stores/disc-store'
import { generateTmdbQueries } from '../utils/title-utils'

interface UseDiscDetectionOptions {
  pollInterval?: number
  autoLoadDiscInfo?: boolean
}

// ── Module-level singleton guard ─────────────────────────────────
// Prevents multiple hook instances from spawning concurrent pollers.
// Only one active polling interval runs at a time.
let activePollerCount = 0

export function useDiscDetection(opts: UseDiscDetectionOptions | number = 5000) {
  // Support legacy numeric arg or options object
  const { pollInterval = 5000, autoLoadDiscInfo: autoLoad = false } =
    typeof opts === 'number' ? { pollInterval: opts } : opts

  const { setDrives, setScanning } = useDiscStore()
  const intervalRef = useRef<ReturnType<typeof setInterval>>()
  // Track whether we've auto-loaded for the current disc presence.
  // Reset to false when drive state changes (disc ejected or inserted).
  const autoLoaded = useRef(false)
  // Track the last drive state hash to detect changes (handles same-name discs)
  const lastDriveHash = useRef('')
  // Cooldown after failed scans — prevents infinite retry loop
  const failedCooldownUntil = useRef(0)

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      const drives = await window.ztr.disc.detect()
      setDrives(drives || [])
    } catch (err) {
      console.error('[useDiscDetection] detect() failed:', err)
    } finally {
      setScanning(false)
    }
  }, [setDrives, setScanning])

  const autoSearchTmdb = useCallback(async (title: string) => {
    const { setTmdbResult, updateDiscSession } = useDiscStore.getState()
    const queries = generateTmdbQueries(title)
    if (queries.length === 0) return

    console.log(`[useDiscDetection] Auto TMDB search: queries=${JSON.stringify(queries)}`)

    // Try each query variant until one returns results
    for (const query of queries) {
      try {
        const results = await window.ztr.tmdb.search(query, 'movie')

        if (!results || results.length === 0) continue

        const best = results[0]
        const year = (best.release_date || best.first_air_date || '').split('-')[0]
        console.log(`[useDiscDetection] TMDB match: "${best.title}" (${year}) — #${best.id}`)

        const tmdbResult = {
          id: best.id,
          title: best.title,
          year,
          poster_path: best.poster_path,
          overview: best.overview,
          vote_average: best.vote_average,
          belongs_to_collection: null
        }
        setTmdbResult(tmdbResult)

        updateDiscSession({
          kodiTitle: best.title,
          kodiYear: year,
          kodiTmdbId: best.id,
          sessionDiscId: useDiscStore.getState().discInfo?.discId ?? null
        })

        // Cache TMDB result for disc recognition
        const currentDiscId = useDiscStore.getState().discInfo?.discId
        if (currentDiscId) {
          window.ztr.disc.setTmdbCache(currentDiscId, tmdbResult).catch(() => {})
        }

        // Fetch full details for collection info
        try {
          const details = await window.ztr.tmdb.getDetails(best.id, 'movie')
          if (details?.belongs_to_collection) {
            console.log(`[useDiscDetection] TMDB collection: "${details.belongs_to_collection.name}"`)
            const tmdbWithCollection = {
              id: best.id,
              title: best.title,
              year,
              poster_path: best.poster_path,
              overview: best.overview,
              vote_average: best.vote_average,
              belongs_to_collection: details.belongs_to_collection
            }
            setTmdbResult(tmdbWithCollection)
            updateDiscSession({
              kodiSetName: details.belongs_to_collection.name
            })
            // Update cache with collection info
            const cDiscId = useDiscStore.getState().discInfo?.discId
            if (cDiscId) {
              window.ztr.disc.setTmdbCache(cDiscId, tmdbWithCollection).catch(() => {})
            }
          }
        } catch { /* best-effort */ }

        return // Found a match, stop trying
      } catch (err) {
        console.error(`[useDiscDetection] TMDB search "${query}" failed:`, err)
      }
    }

    console.warn('[useDiscDetection] TMDB returned no results for any query variant')
  }, [])

  const loadDiscInfo = useCallback(async (driveIndex: number, forceRefresh = false) => {
    const { setDiscInfo, setLoading, setSelectedDrive, drives } = useDiscStore.getState()
    setSelectedDrive(driveIndex)
    setLoading(true)
    console.log(`[useDiscDetection] loadDiscInfo(${driveIndex}, forceRefresh=${forceRefresh})`)

    // ── Cache disabled: always do a fresh MakeMKV scan ──
    // Cache was causing stale data when swapping discs in the same set
    // (same volume name → cache returns disc 1 info for disc 2)

    // ── Full MakeMKV scan (single attempt — MakeMKV already has long internal timeouts) ──
    // No immediate retries: if MakeMKV can't read the disc, retrying instantly
    // just hammers the drive and confuses it. A 60s cooldown is enforced before
    // auto-load can try again. The user can always click "Retry Scan" manually.
    const MAX_RETRIES = 2
    const RETRY_DELAY_MS = 15000 // 15s between retries — give the drive time to settle

    let succeeded = false
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[useDiscDetection] getInfo attempt ${attempt}/${MAX_RETRIES} for drive ${driveIndex}`)
        const info = await window.ztr.disc.getInfo(driveIndex)
        console.log(`[useDiscDetection] getInfo result (attempt ${attempt}/${MAX_RETRIES}):`,
          info ? `"${info.title}" (${info.discType}) ${info.trackCount} tracks` : 'null')

        // Retry if scan returned null (timeout/error) or 0 tracks while disc is present
        const shouldRetry = attempt < MAX_RETRIES && (
          info === null ||
          (info.trackCount === 0 && useDiscStore.getState().drives.some(
            d => d.index === driveIndex && (d.discTitle || d.discType)
          ))
        )

        if (shouldRetry) {
          const reason = info === null ? 'scan failed/timed out' : 'TCOUNT:0 but disc present'
          console.warn(`[useDiscDetection] ${reason} — retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})`)
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
          continue
        }

        setDiscInfo(info)
        succeeded = info !== null && info.trackCount > 0

        // Auto-search TMDB after successful disc load
        if (info?.title) {
          autoSearchTmdb(info.title)
        }
        break // Success or no retry needed
      } catch (err) {
        console.error(`[useDiscDetection] getInfo failed (attempt ${attempt}/${MAX_RETRIES}):`, err)
        if (attempt === MAX_RETRIES) {
          setDiscInfo(null)
        } else {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        }
      }
    }

    // If all retries failed, set a cooldown to prevent infinite retry storm.
    // autoLoaded stays true — only a disc swap (hash change) or manual Retry resets it.
    // The cooldown allows ONE more auto-attempt after 60 seconds, in case the drive
    // just needed time to spin up.
    if (!succeeded) {
      const COOLDOWN_MS = 60000
      failedCooldownUntil.current = Date.now() + COOLDOWN_MS
      console.warn(`[useDiscDetection] All retries exhausted — cooldown for ${COOLDOWN_MS / 1000}s. Use Retry Scan for manual rescan.`)
    }

    setLoading(false)
  }, [autoSearchTmdb])

  // Helper: check if we should auto-load for the current drive state.
  // Uses a hash of the drive flags to detect ANY change (works even when
  // two discs share the same volume name, e.g. discs in a box set).
  const tryAutoLoad = useCallback(() => {
    const { loading, drives } = useDiscStore.getState()
    if (loading) return

    // Build a hash of drive state — includes flags, disc title, disc type
    // When the OS detects a disc change (even same-name swap), at least the
    // discType or presence flag changes briefly, which resets our tracker.
    const driveWithDisc = drives.find((d) => d.discTitle || d.discType)
    const currentHash = driveWithDisc
      ? `${driveWithDisc.index}:${driveWithDisc.discTitle}:${driveWithDisc.discType}:present`
      : 'empty'

    // Detect drive state change → reset auto-load flag and clear cooldown
    if (currentHash !== lastDriveHash.current) {
      const wasEmpty = lastDriveHash.current === '' || lastDriveHash.current === 'empty'
      lastDriveHash.current = currentHash
      autoLoaded.current = false
      failedCooldownUntil.current = 0 // Clear cooldown on disc swap
      if (!wasEmpty && currentHash === 'empty') {
        console.log('[useDiscDetection] Disc ejected — ready for next disc')
        return
      }
    }

    if (!driveWithDisc) return
    if (autoLoaded.current) return

    // Respect cooldown after failed scans (prevents infinite retry storm)
    if (failedCooldownUntil.current > Date.now()) {
      return
    }

    autoLoaded.current = true
    console.log(`[useDiscDetection] Auto-loading disc info for drive ${driveWithDisc.index} (disc="${driveWithDisc.discTitle || driveWithDisc.discType}")`)
    loadDiscInfo(driveWithDisc.index)
  }, [loadDiscInfo])

  // Auto-load disc info when a drive with disc is first detected
  useEffect(() => {
    if (!autoLoad) return
    tryAutoLoad()
  })

  // Subscribe to store changes to detect when drives become available or disc changes
  useEffect(() => {
    if (!autoLoad) return
    const unsub = useDiscStore.subscribe(() => {
      tryAutoLoad()
    })
    return unsub
  }, [autoLoad, tryAutoLoad])

  // Polling: do an initial scan, then optionally set up interval.
  // Singleton guard: only the FIRST hook instance with pollInterval>0 creates the interval.
  useEffect(() => {
    // Always do one scan on mount (it's fast, uses --noscan)
    const { drives } = useDiscStore.getState()
    if (drives.length === 0) {
      scan()
    }

    // Only set up polling interval if no other instance is already polling
    if (pollInterval > 0 && activePollerCount === 0) {
      activePollerCount++
      console.log(`[useDiscDetection] Starting poller (interval=${pollInterval}ms)`)
      intervalRef.current = setInterval(scan, pollInterval)
      return () => {
        activePollerCount--
        if (intervalRef.current) clearInterval(intervalRef.current)
        console.log('[useDiscDetection] Stopped poller')
      }
    }
  }, [scan, pollInterval])

  const rescanDisc = useCallback(async (forceRefresh = false) => {
    const { drives, selectedDrive } = useDiscStore.getState()
    const driveIndex = selectedDrive ?? drives.find(d => d.discTitle || d.discType)?.index ?? 0
    autoLoaded.current = false // Reset so auto-load can re-trigger
    failedCooldownUntil.current = 0 // Clear cooldown — manual retry always works
    console.log(`[useDiscDetection] Manual rescan triggered for drive ${driveIndex} (forceRefresh=${forceRefresh})`)
    await loadDiscInfo(driveIndex, forceRefresh)
  }, [loadDiscInfo])

  return { scan, loadDiscInfo, rescanDisc }
}
