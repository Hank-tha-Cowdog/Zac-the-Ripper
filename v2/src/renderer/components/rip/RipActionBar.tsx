import React from 'react'
import { Disc3, ArrowUpFromLine } from 'lucide-react'
import { Button, Badge, Tooltip } from '../ui'
import { useDiscStore } from '../../stores/disc-store'

interface RipActionBarProps {
  modes: Record<string, boolean>
  onRip: () => void
  onEject: () => void
  isRipping: boolean
  standbyMessage?: string | null
}

export function RipActionBar({ modes, onRip, onEject, isRipping, standbyMessage }: RipActionBarProps) {
  const { selectedTracks, discInfo } = useDiscStore()

  const enabledModes = Object.entries(modes).filter(([, v]) => v).map(([k]) => k)
  const trackCount = selectedTracks.length

  const totalSize = discInfo?.tracks
    .filter((t) => selectedTracks.includes(t.id))
    .reduce((sum, t) => sum + t.sizeBytes, 0) || 0

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
  }

  const subtitleCount = discInfo?.tracks
    .filter((t) => selectedTracks.includes(t.id))
    .reduce((sum, t) => sum + t.subtitleTracks.length, 0) || 0

  const canRip = trackCount > 0 && enabledModes.length > 0 && !isRipping

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-4 bg-zinc-900/80 border border-zinc-800 rounded-lg">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="label-tech">Tracks</span>
            <Badge>{trackCount}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="label-tech">Modes</span>
            {enabledModes.map((mode) => (
              <Badge key={mode} variant="default">{mode.replace('_', ' ')}</Badge>
            ))}
          </div>
          {subtitleCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="label-tech">Subtitles</span>
              <Badge variant="info">{subtitleCount}</Badge>
            </div>
          )}
          <div className="text-xs text-zinc-500 font-mono">
            ~{formatSize(totalSize)} raw
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Tooltip content="Eject the disc from the drive.">
            <Button
              variant="secondary"
              size="lg"
              onClick={onEject}
              disabled={isRipping}
            >
              <ArrowUpFromLine className="w-5 h-5" />
            </Button>
          </Tooltip>
          <Button
            variant="primary"
            size="lg"
            disabled={!canRip}
            onClick={onRip}
            icon={<Disc3 className={`w-5 h-5${isRipping ? ' animate-spin' : ''}`} />}
            className={`px-8${isRipping ? ' animate-rip-button' : canRip ? ' animate-rip-ready' : ''}`}
          >
            <span className={isRipping ? 'animate-rip-text' : ''}>
              {isRipping ? 'Ripping...' : 'RIP!'}
            </span>
          </Button>
        </div>
      </div>

      {standbyMessage && (
        <div className="flex items-center gap-2 px-4 py-2 bg-purple-500/5 border border-purple-500/20 rounded-lg animate-fade-in">
          <div className="status-dot status-dot-processing" />
          <span className="text-sm text-purple-300 font-mono">{standbyMessage}</span>
        </div>
      )}
    </div>
  )
}
