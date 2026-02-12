import React, { useEffect, useState } from 'react'
import { Disc3, AlertTriangle, Film, Music, Subtitles, Clock, Star } from 'lucide-react'
import { Card, Badge, Spinner, Tooltip } from '../ui'
import { useDiscStore } from '../../stores/disc-store'

function getVideoStandard(framerate: string): { label: string; tooltip: string } {
  if (framerate.includes('25') || framerate.includes('50')) {
    return { label: 'PAL', tooltip: 'PAL (25fps) — Europe, Australia, Region 2/4' }
  }
  if (framerate.includes('29.97') || framerate.includes('59.94')) {
    return { label: 'NTSC', tooltip: 'NTSC (29.97fps) — North America, Japan, Region 1' }
  }
  if (framerate.includes('23.976') || framerate.includes('24')) {
    return { label: 'Film', tooltip: '23.976/24fps — Film content (telecine removed)' }
  }
  return { label: framerate + 'fps', tooltip: `Framerate: ${framerate}fps` }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`
}

function summarizeAudio(tracks: Array<{ codec: string; language: string; channels: string }>): string {
  if (tracks.length === 0) return 'None'
  const langs = [...new Set(tracks.map(t => t.language.slice(0, 3).toUpperCase()))]
  const mainCodec = tracks[0].codec
  const mainCh = tracks[0].channels
  return `${tracks.length} track${tracks.length > 1 ? 's' : ''} (${langs.join(', ')}) ${mainCodec} ${mainCh}`
}

export function DiscInfoCard() {
  const { discInfo, loading, tmdbResult } = useDiscStore()
  const [tmdbKeyMissing, setTmdbKeyMissing] = useState(false)

  useEffect(() => {
    window.ztr.settings.get('kodi.tmdb_api_key').then((val: string) => {
      setTmdbKeyMissing(!val)
    })
  }, [])

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-8 gap-3">
        <Spinner />
        <span className="text-sm text-zinc-400">Loading disc info...</span>
      </Card>
    )
  }

  if (!discInfo) {
    return (
      <Card className="flex flex-col items-center justify-center p-8 text-center">
        <Disc3 className="w-8 h-8 text-zinc-700 mb-2" />
        <span className="text-sm text-zinc-500">No disc loaded</span>
        <span className="text-xs text-zinc-600 mt-1">Insert a disc to start scanning automatically</span>
      </Card>
    )
  }

  const mainTrack = discInfo.tracks[0]
  const resolution = mainTrack?.resolution || ''
  const framerate = mainTrack?.framerate || ''
  const isInterlaced = discInfo.tracks.some((t) => t.isInterlaced)
  const videoStd = getVideoStandard(framerate)
  const totalAudio = discInfo.tracks.reduce((sum, t) => sum + t.audioTracks.length, 0)
  const totalSubs = discInfo.tracks.reduce((sum, t) => sum + t.subtitleTracks.length, 0)
  const mainAudio = mainTrack?.audioTracks || []

  return (
    <Card className="p-3">
      <div className="flex gap-3">
        {/* Poster */}
        {tmdbResult?.poster_path && (
          <img
            src={`https://image.tmdb.org/t/p/w185${tmdbResult.poster_path}`}
            alt={tmdbResult.title}
            className="w-24 h-36 rounded object-cover shrink-0 shadow-lg shadow-purple-500/10"
          />
        )}

        {/* Main info */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Disc3 className="w-4 h-4 text-purple-400 shrink-0" />
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{discInfo.title}</h3>
          </div>

          {/* Badges row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Tooltip content={`Disc type: ${discInfo.discType}. DVD = SD, BD = 1080p, UHD_BD = 4K HDR.`}>
              <Badge>{discInfo.discType}</Badge>
            </Tooltip>
            {resolution && (
              <Tooltip content={isInterlaced
                ? `Interlaced source (${resolution}). Will be deinterlaced with yadif during encode.`
                : `Progressive scan at ${resolution}.`
              }>
                <Badge variant={isInterlaced ? 'warning' : 'info'}>
                  {resolution}{isInterlaced ? 'i' : 'p'}
                </Badge>
              </Tooltip>
            )}
            <Tooltip content={videoStd.tooltip}>
              <Badge variant="info">{videoStd.label}</Badge>
            </Tooltip>
            {discInfo.discType === 'DVD' && (
              <Tooltip content="SD content will be color-converted from rec601 to rec709 during encode for modern playback compatibility.">
                <Badge variant="info">601→709</Badge>
              </Tooltip>
            )}
          </div>

          {/* TMDB match info */}
          {tmdbResult && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Film className="w-3 h-3 text-purple-400 shrink-0" />
                <span className="text-xs font-medium text-zinc-200 truncate">
                  {tmdbResult.title} ({tmdbResult.year})
                </span>
                <Badge variant="success" className="shrink-0">TMDB #{tmdbResult.id}</Badge>
                {tmdbResult.vote_average > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-amber-400 shrink-0">
                    <Star className="w-2.5 h-2.5 fill-amber-400" />
                    {tmdbResult.vote_average.toFixed(1)}
                  </span>
                )}
              </div>
              {tmdbResult.overview && (
                <p className="text-[11px] text-zinc-500 line-clamp-2 leading-tight">
                  {tmdbResult.overview}
                </p>
              )}
            </div>
          )}

          {/* Technical metadata grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] pt-1 border-t border-zinc-800/50">
            <div className="flex items-center gap-1.5">
              <Music className="w-2.5 h-2.5 text-cyan-500" />
              <span className="text-zinc-500">Audio</span>
              <span className="text-zinc-300 font-mono truncate">{summarizeAudio(mainAudio)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Subtitles className="w-2.5 h-2.5 text-emerald-500" />
              <span className="text-zinc-500">Subs</span>
              <span className="text-zinc-300 font-mono">{mainTrack?.subtitleTracks.length || 0} tracks</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-2.5 h-2.5 text-zinc-500" />
              <span className="text-zinc-500">Duration</span>
              <span className="text-zinc-300 font-mono">{mainTrack ? formatDuration(mainTrack.durationSeconds) : '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 text-zinc-600 text-center font-mono text-[8px] font-bold">#</span>
              <span className="text-zinc-500">Disc ID</span>
              <span className="text-zinc-300 font-mono truncate">{discInfo.discId}</span>
            </div>
          </div>
        </div>
      </div>

      {tmdbKeyMissing && !tmdbResult && (
        <div className="mt-2 flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          TMDB API key not set — poster and metadata lookup disabled. Add your key in Settings &gt; Kodi.
        </div>
      )}
    </Card>
  )
}
