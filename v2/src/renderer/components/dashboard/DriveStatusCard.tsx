import React from 'react'
import { Disc3, ScanLine, Film, Music, Clock } from 'lucide-react'
import { Card, Badge, StatusDot, Button, Tooltip } from '../ui'

interface DriveStatusCardProps {
  drive: {
    index: number
    name: string
    devicePath: string
    discTitle: string | null
    discType: string | null
  }
  onScan: (index: number) => void
  onRip: (index: number) => void
  tmdbPosterPath?: string | null
  tmdbTitle?: string | null
  tmdbYear?: string | null
  scannedTitle?: string | null
  discInfo?: {
    trackCount: number
    resolution?: string
    framerate?: string
    duration?: string
    audioSummary?: string
  } | null
}

function getVideoStdLabel(framerate: string): string {
  if (framerate.includes('25') || framerate.includes('50')) return 'PAL'
  if (framerate.includes('29.97') || framerate.includes('59.94')) return 'NTSC'
  if (framerate.includes('23.976') || framerate.includes('24')) return 'Film'
  return ''
}

export function DriveStatusCard({ drive, onScan, onRip, tmdbPosterPath, tmdbTitle, tmdbYear, scannedTitle, discInfo }: DriveStatusCardProps) {
  const hasDisc = !!(drive.discTitle || drive.discType)
  const displayTitle = drive.discTitle || scannedTitle
  const videoStd = discInfo?.framerate ? getVideoStdLabel(discInfo.framerate) : ''

  return (
    <Card className="flex items-center gap-3 p-3">
      {tmdbPosterPath && (
        <img
          src={`https://image.tmdb.org/t/p/w92${tmdbPosterPath}`}
          alt="Poster"
          className="w-10 h-[60px] rounded object-cover shrink-0 shadow-md"
        />
      )}

      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Tooltip content={hasDisc ? 'Disc detected and ready to scan or rip.' : 'No disc detected in this drive. Insert a disc and click Scan.'}>
          <StatusDot status={hasDisc ? 'ready' : 'pending'} />
        </Tooltip>
        <Disc3 className={`w-5 h-5 shrink-0 ${hasDisc ? 'text-purple-400' : 'text-zinc-600'}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100 truncate">
            {drive.name}
          </div>
          {tmdbTitle ? (
            <div className="flex items-center gap-1.5">
              <Film className="w-3 h-3 text-purple-400 shrink-0" />
              <span className="text-xs text-purple-300 font-medium truncate">
                {tmdbTitle} ({tmdbYear})
              </span>
            </div>
          ) : displayTitle ? (
            <div className="text-xs text-purple-400 font-medium truncate">
              {displayTitle}
            </div>
          ) : (
            <div className="text-[10px] text-zinc-500 font-mono truncate">
              {hasDisc ? 'Disc detected — click Scan to read title' : (drive.devicePath || `Drive ${drive.index}`)}
            </div>
          )}
          {discInfo && (
            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-zinc-500 font-mono">
              {discInfo.resolution && (
                <span>{discInfo.resolution}{videoStd ? ` ${videoStd}` : ''}</span>
              )}
              {discInfo.duration && (
                <span className="flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {discInfo.duration}
                </span>
              )}
              {discInfo.audioSummary && (
                <span className="flex items-center gap-0.5">
                  <Music className="w-2.5 h-2.5" />
                  {discInfo.audioSummary}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {drive.discType && (
        <Tooltip content={
          drive.discType === 'DVD' ? 'DVD disc — standard definition (480i/576i MPEG-2)' :
          drive.discType === 'BD' ? 'Blu-ray disc — 1080p high definition (H.264/VC-1)' :
          drive.discType === 'UHD_BD' ? 'Ultra HD Blu-ray — 4K (2160p) with HDR and HEVC' :
          `Detected disc type: ${drive.discType}`
        }>
          <Badge>{drive.discType}</Badge>
        </Tooltip>
      )}

      <div className="flex items-center gap-2 shrink-0">
        <Tooltip content="Scan the disc to enumerate all titles, audio tracks, and subtitles. Requires MakeMKV for full track listing.">
          <Button variant="ghost" size="sm" onClick={() => onScan(drive.index)}>
            <ScanLine className="w-4 h-4" />
          </Button>
        </Tooltip>
        {hasDisc && (
          <Tooltip content="Go to the Rip page to select tracks and encoding modes for this disc.">
            <Button variant="primary" size="sm" onClick={() => onRip(drive.index)}>
              Rip
            </Button>
          </Tooltip>
        )}
      </div>
    </Card>
  )
}
