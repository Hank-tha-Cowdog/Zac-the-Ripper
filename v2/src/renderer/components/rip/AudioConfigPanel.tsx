import React, { useEffect, useState, useCallback } from 'react'
import { Search, Disc3, Music, Image, FolderOpen } from 'lucide-react'
import { Card, Badge, TechLabel, Button, Spinner } from '../ui'
import { useDiscStore, type MusicTrackMeta } from '../../stores/disc-store'

interface AudioConfigPanelProps {
  musicOutputPath: string
  onMusicOutputPathChange: (path: string) => void
}

interface MBReleaseCandidate {
  id: string
  title: string
  artist: string
  albumArtist: string
  year: string
  discNumber: number
  totalDiscs: number
  isVariousArtists: boolean
  tracks: Array<{ number: number; title: string; artist: string; recordingId?: string }>
  albumArtistId?: string | null
  genre?: string | null
  coverArtUrl?: string | null
}

function applyRelease(release: MBReleaseCandidate, updateDiscSession: (patch: Record<string, unknown>) => void): void {
  updateDiscSession({
    musicArtist: release.artist,
    musicAlbumArtist: release.albumArtist || release.artist,
    musicAlbum: release.title,
    musicYear: release.year,
    musicDiscNumber: release.discNumber,
    musicTotalDiscs: release.totalDiscs,
    musicMbReleaseId: release.id,
    musicIsVariousArtists: release.isVariousArtists,
    musicTracks: release.tracks.map(t => ({ number: t.number, title: t.title, artist: t.artist, recordingId: t.recordingId || '' })),
    musicAlbumArtistId: release.albumArtistId ?? null,
    musicGenre: release.genre ?? null,
    musicCoverArtUrl: release.coverArtUrl ?? null,
    // A fresh release match invalidates any earlier manual cover override.
    musicCoverArtPath: null
  })
}

export function AudioConfigPanel({ musicOutputPath, onMusicOutputPathChange }: AudioConfigPanelProps) {
  const { discInfo, discSession, updateDiscSession } = useDiscStore()
  const [mbLoading, setMbLoading] = useState(false)
  const [mbSearchQuery, setMbSearchQuery] = useState('')
  const [mbSearchResults, setMbSearchResults] = useState<Array<{
    id: string; title: string; artist: string; year: string
  }>>([])
  const [mbSearching, setMbSearching] = useState(false)
  // Populated when a disc ID matches more than one MusicBrainz release
  // (common: reissues/regional pressings share an identical TOC) — the
  // user picks the right one instead of us silently guessing releases[0].
  const [mbCandidates, setMbCandidates] = useState<MBReleaseCandidate[]>([])
  // Cover Art Archive doesn't have an image for every release (common for
  // obscure/regional pressings) — remember which specific src failed so we
  // can show a placeholder instead of a permanently broken image icon.
  // Keyed by src (not a plain boolean) so switching to a new cover just
  // stops matching this value — no effect/extra render needed to reset it.
  const [failedCoverSrc, setFailedCoverSrc] = useState<string | null>(null)

  // Auto-lookup on mount when disc has MusicBrainz disc ID
  useEffect(() => {
    const discId = discInfo?.metadata?.musicbrainzDiscId
    if (!discId || discSession.musicMbReleaseId) return

    const doLookup = async () => {
      try {
        const autoLookup = await window.ztr.settings.get('audio.musicbrainz_auto_lookup')
        if (autoLookup === 'false') return

        setMbLoading(true)
        const results = await window.ztr.musicbrainz.lookupCandidates(discId)
        if (results && results.length === 1) {
          applyRelease(results[0], updateDiscSession)
        } else if (results && results.length > 1) {
          setMbCandidates(results)
        }
      } catch (err) {
        console.warn('MusicBrainz auto-lookup failed:', err)
      } finally {
        setMbLoading(false)
      }
    }

    doLookup()
  }, [discInfo?.metadata?.musicbrainzDiscId])

  const handleMbSearch = useCallback(async () => {
    if (!mbSearchQuery.trim()) return
    setMbSearching(true)
    try {
      const results = await window.ztr.musicbrainz.search(mbSearchQuery)
      setMbSearchResults(results || [])
    } catch (err) {
      console.warn('MusicBrainz search failed:', err)
    } finally {
      setMbSearching(false)
    }
  }, [mbSearchQuery])

  const handleMbSelect = useCallback(async (release: { id: string; title: string; artist: string; year: string; albumArtist: string; isVariousArtists: boolean; discNumber: number; totalDiscs: number }) => {
    setMbLoading(true)
    try {
      // The search endpoint returns album-level stubs with no track list —
      // fetch the full release (including tracks) by its MBID before applying.
      const full = await window.ztr.musicbrainz.lookupById(release.id)
      if (full) {
        applyRelease(full, updateDiscSession)
      } else {
        // MB lookup-by-id failed (network blip, deleted release, etc.) —
        // fall back to the stub so the user isn't left with nothing.
        applyRelease({ ...release, tracks: [] }, updateDiscSession)
      }
      setMbCandidates([])
      setMbSearchResults([])
      setMbSearchQuery('')
    } catch (err) {
      console.warn('MusicBrainz release detail fetch failed:', err)
      applyRelease({ ...release, tracks: [] }, updateDiscSession)
    } finally {
      setMbLoading(false)
    }
  }, [updateDiscSession])

  const handleCandidateSelect = useCallback((release: MBReleaseCandidate) => {
    applyRelease(release, updateDiscSession)
    setMbCandidates([])
  }, [updateDiscSession])

  const handleTrackChange = useCallback((index: number, field: keyof MusicTrackMeta, value: string | number) => {
    const newTracks = [...discSession.musicTracks]
    newTracks[index] = { ...newTracks[index], [field]: value }
    updateDiscSession({ musicTracks: newTracks })
  }, [discSession.musicTracks, updateDiscSession])

  const handleSelectOutputDir = async () => {
    const dir = await window.ztr.fs.selectDirectory('Select Music Library Folder')
    if (dir) onMusicOutputPathChange(dir)
  }

  const handleSelectCoverArt = useCallback(async () => {
    const path = await window.ztr.fs.selectFile('Select Cover Art', [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }
    ])
    if (path) updateDiscSession({ musicCoverArtPath: path })
  }, [updateDiscSession])

  const {
    musicArtist, musicAlbumArtist, musicAlbum, musicYear,
    musicDiscNumber, musicTotalDiscs, musicTracks,
    musicMbReleaseId, musicIsVariousArtists, musicCoverArtPath, musicCoverArtUrl
  } = discSession

  const coverPreviewSrc = musicCoverArtPath ? `file://${musicCoverArtPath}` : musicCoverArtUrl
  const coverArtLoadFailed = coverPreviewSrc !== null && coverPreviewSrc === failedCoverSrc

  return (
    <div className="space-y-4">
      {/* MusicBrainz Status */}
      <Card>
        <TechLabel className="mb-3 block">MusicBrainz</TechLabel>

        {mbLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Spinner /> Looking up disc...
          </div>
        ) : musicMbReleaseId ? (
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="success">Matched</Badge>
            <span className="text-zinc-400 font-mono truncate">{musicMbReleaseId}</span>
          </div>
        ) : mbCandidates.length > 0 ? (
          <div className="text-xs text-zinc-500">
            {mbCandidates.length} matching releases found — pick one:
          </div>
        ) : (
          <div className="text-xs text-zinc-500">No match — try manual search below</div>
        )}

        {/* Disambiguation picker: same disc ID matched multiple releases */}
        {!musicMbReleaseId && mbCandidates.length > 0 && (
          <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
            {mbCandidates.map((c) => (
              <button
                key={c.id}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-800 text-xs transition-colors"
                onClick={() => handleCandidateSelect(c)}
              >
                <span className="text-zinc-200 font-medium">{c.artist}</span>
                <span className="text-zinc-500"> — </span>
                <span className="text-zinc-300">{c.title}</span>
                {c.year && <span className="text-zinc-600 ml-1">({c.year})</span>}
                <span className="text-zinc-600 ml-1">· {c.tracks.length} tracks</span>
              </button>
            ))}
          </div>
        )}

        {/* Manual search */}
        <div className="flex gap-2 mt-2">
          <input
            className="input flex-1 text-sm"
            value={mbSearchQuery}
            onChange={(e) => setMbSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleMbSearch()}
            placeholder="Search artist or album..."
          />
          <Button variant="secondary" size="sm" onClick={handleMbSearch} disabled={mbSearching}>
            <Search className="w-3.5 h-3.5" />
          </Button>
        </div>

        {mbSearchResults.length > 0 && (
          <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
            {mbSearchResults.map((r) => (
              <button
                key={r.id}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-800 text-xs transition-colors"
                onClick={() => handleMbSelect(r as typeof r & { albumArtist: string; isVariousArtists: boolean; discNumber: number; totalDiscs: number })}
              >
                <span className="text-zinc-200 font-medium">{r.artist}</span>
                <span className="text-zinc-500"> — </span>
                <span className="text-zinc-300">{r.title}</span>
                {r.year && <span className="text-zinc-600 ml-1">({r.year})</span>}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Album Metadata */}
      <Card>
        <TechLabel className="mb-3 block">Album Info</TechLabel>
        <div className="space-y-2">
          <div>
            <label className="label-tech text-[10px]">Album Artist</label>
            <input
              className="input w-full text-sm"
              value={musicAlbumArtist}
              onChange={(e) => updateDiscSession({ musicAlbumArtist: e.target.value, musicArtist: e.target.value })}
              placeholder="Album Artist"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="label-tech text-[10px]">Album</label>
              <input
                className="input w-full text-sm"
                value={musicAlbum}
                onChange={(e) => updateDiscSession({ musicAlbum: e.target.value })}
                placeholder="Album Title"
              />
            </div>
            <div>
              <label className="label-tech text-[10px]">Year</label>
              <input
                className="input w-full text-sm"
                value={musicYear}
                onChange={(e) => updateDiscSession({ musicYear: e.target.value })}
                placeholder="Year"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label-tech text-[10px]">Disc #</label>
              <input
                className="input w-full text-sm"
                type="number" min="1"
                value={musicDiscNumber}
                onChange={(e) => updateDiscSession({ musicDiscNumber: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div>
              <label className="label-tech text-[10px]">of Total</label>
              <input
                className="input w-full text-sm"
                type="number" min="1"
                value={musicTotalDiscs}
                onChange={(e) => updateDiscSession({ musicTotalDiscs: parseInt(e.target.value) || 1 })}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Cover Art */}
      <Card>
        <TechLabel className="mb-3 block">Cover Art</TechLabel>
        <div className="flex items-center gap-3">
          <div className="w-20 h-20 shrink-0 rounded bg-zinc-800 border border-zinc-700 overflow-hidden flex items-center justify-center">
            {coverPreviewSrc && !coverArtLoadFailed ? (
              <img
                key={coverPreviewSrc}
                src={coverPreviewSrc}
                alt="Album cover"
                className="w-full h-full object-cover"
                onError={() => setFailedCoverSrc(coverPreviewSrc)}
              />
            ) : (
              <Image className="w-6 h-6 text-zinc-600" />
            )}
          </div>
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="text-zinc-500">
              {musicCoverArtPath
                ? 'Using a manually selected image.'
                : musicCoverArtUrl
                  ? (coverArtLoadFailed ? 'MusicBrainz has no art for this release.' : 'Fetched from Cover Art Archive.')
                  : 'No cover art yet — matched automatically at rip time if available.'}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleSelectCoverArt}>
                <FolderOpen className="w-3.5 h-3.5 mr-1" /> Browse...
              </Button>
              {musicCoverArtPath && (
                <Button variant="secondary" size="sm" onClick={() => updateDiscSession({ musicCoverArtPath: null })}>
                  Use MusicBrainz art
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Track List */}
      <Card>
        <TechLabel className="mb-3 block">Track Titles</TechLabel>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {musicTracks.map((track, i) => (
            <div key={track.number} className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-600 font-mono w-5 text-right shrink-0">
                {String(track.number).padStart(2, '0')}
              </span>
              <input
                className="input flex-1 text-xs py-1"
                value={track.title}
                onChange={(e) => handleTrackChange(i, 'title', e.target.value)}
                placeholder={`Track ${track.number}`}
              />
              {musicIsVariousArtists && (
                <input
                  className="input w-28 text-xs py-1"
                  value={track.artist}
                  onChange={(e) => handleTrackChange(i, 'artist', e.target.value)}
                  placeholder="Artist"
                />
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Output */}
      <Card>
        <TechLabel className="mb-3 block">Output</TechLabel>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="info">
              <Music className="w-3 h-3 mr-1" />
              FLAC
            </Badge>
            <span className="text-[10px] text-zinc-500">Lossless audio — Navidrome handles transcoding</span>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="label-tech text-[10px]">Music Library Path</label>
              <input
                className="input w-full text-xs"
                value={musicOutputPath}
                onChange={(e) => onMusicOutputPathChange(e.target.value)}
                placeholder="~/Music/Zac the Ripper"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={handleSelectOutputDir}>
              <FolderOpen className="w-3.5 h-3.5" />
            </Button>
          </div>
          {musicAlbumArtist && musicAlbum && (
            <div className="text-[10px] text-zinc-600 font-mono truncate">
              → {musicAlbumArtist}/{musicAlbum}{musicYear ? ` (${musicYear})` : ''}
              {musicTotalDiscs > 1 ? ` (Disc ${musicDiscNumber})` : ''}/
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
