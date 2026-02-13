import { useEffect, useCallback, useRef } from 'react'
import { useDiscStore } from '../stores/disc-store'
import { cleanDiscTitle, generateTmdbQueries } from '../utils/title-utils'

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
  const autoLoadAttempted = useRef(false)

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
    const { setDiscInfo, setLoading, setSelectedDrive, setTmdbResult, updateDiscSession, drives } = useDiscStore.getState()
    setSelectedDrive(driveIndex)
    setLoading(true)
    console.log(`[useDiscDetection] loadDiscInfo(${driveIndex}, forceRefresh=${forceRefresh})`)

    // ── Cache-first: try to load cached DiscInfo by volume name ──
    const drive = drives.find(d => d.index === driveIndex)
    if (!forceRefresh && drive?.discTitle) {
      try {
        const cached = await window.ztr.disc.getInfoCached(drive.discTitle)
        if (cached) {
          console.log(`[useDiscDetection] Cache hit for "${drive.discTitle}" — showing cached info instantly`)
          setDiscInfo(cached)
          setLoading(false)

          // Restore TMDB cache if available, otherwise auto-search
          if (cached._tmdbCache) {
            const tmdb = cached._tmdbCache
            setTmdbResult(tmdb)
            updateDiscSession({
              kodiTitle: tmdb.title,
              kodiYear: tmdb.year,
              kodiTmdbId: tmdb.id,
              sessionDiscId: cached.discId
            })
            if (tmdb.belongs_to_collection) {
              updateDiscSession({ kodiSetName: tmdb.belongs_to_collection.name })
            }
            console.log(`[useDiscDetection] TMDB restored from cache: "${tmdb.title}" (${tmdb.year})`)
          } else if (cached.title) {
            autoSearchTmdb(cached.title)
          }

          // Continue with full scan in background to refresh cache
          window.ztr.disc.getInfo(driveIndex).then((fresh: unknown) => {
            if (fresh) {
              console.log('[useDiscDetection] Background refresh complete — updating with fresh info')
              setDiscInfo(fresh as Parameters<typeof setDiscInfo>[0])
            }
          }).catch((err: unknown) => {
            console.warn('[useDiscDetection] Background refresh failed:', err)
          })
          return
        }
      } catch (err) {
        console.warn('[useDiscDetection] Cache lookup failed:', err)
      }
    }

    // ── No cache hit: full MakeMKV scan (with retry for TCOUNT:0) ──
    const MAX_RETRIES = 3
    const RETRY_DELAY_MS = 5000

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const info = await window.ztr.disc.getInfo(driveIndex)
        console.log(`[useDiscDetection] getInfo result (attempt ${attempt}/${MAX_RETRIES}):`,
          info ? `"${info.title}" (${info.discType}) ${info.trackCount} tracks` : 'null')

        // If MakeMKV returned 0 tracks but we know a disc is present, retry after delay
        if (info && info.trackCount === 0 && attempt < MAX_RETRIES) {
          const currentDrives = useDiscStore.getState().drives
          const driveHasDisc = currentDrives.some(d => d.index === driveIndex && (d.discTitle || d.discType))
          if (driveHasDisc) {
            console.warn(`[useDiscDetection] TCOUNT:0 but disc is present — retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})`)
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
            continue
          }
        }

        setDiscInfo(info)

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

    setLoading(false)
  }, [autoSearchTmdb])

  // Auto-load disc info when a drive with disc is first detected
  useEffect(() => {
    if (!autoLoad || autoLoadAttempted.current) return
    const { discInfo, loading, drives } = useDiscStore.getState()
    if (discInfo || loading) return

    const driveWithDisc = drives.find((d) => d.discTitle || d.discType)
    if (driveWithDisc) {
      autoLoadAttempted.current = true
      console.log(`[useDiscDetection] Auto-loading disc info for drive ${driveWithDisc.index}`)
      loadDiscInfo(driveWithDisc.index)
    }
  })

  // Subscribe to store changes to detect when drives become available
  useEffect(() => {
    if (!autoLoad) return
    const unsub = useDiscStore.subscribe((state) => {
      if (autoLoadAttempted.current) return
      const { discInfo, loading, drives } = state
      if (discInfo || loading) return

      const driveWithDisc = drives.find((d) => d.discTitle || d.discType)
      if (driveWithDisc) {
        autoLoadAttempted.current = true
        console.log(`[useDiscDetection] Auto-loading disc info (subscription) for drive ${driveWithDisc.index}`)
        loadDiscInfo(driveWithDisc.index)
      }
    })
    return unsub
  }, [autoLoad, loadDiscInfo])

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
    autoLoadAttempted.current = false
    console.log(`[useDiscDetection] Manual rescan triggered for drive ${driveIndex} (forceRefresh=${forceRefresh})`)
    await loadDiscInfo(driveIndex, forceRefresh)
  }, [loadDiscInfo])

  return { scan, loadDiscInfo, rescanDisc }
}
