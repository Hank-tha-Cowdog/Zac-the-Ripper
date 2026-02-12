import React from 'react'
import { FolderOpen } from 'lucide-react'
import { Card, Toggle, Button, TechLabel, Input, Tooltip } from '../ui'
import { useAppStore } from '../../stores/app-store'
import { useDiscStore } from '../../stores/disc-store'

interface RipModesPanelProps {
  modes: Record<string, boolean>
  onModesChange: (modes: Record<string, boolean>) => void
  preserveInterlaced: boolean
  onPreserveInterlacedChange: (v: boolean) => void
  convertSubsToSrt: boolean
  onConvertSubsToSrtChange: (v: boolean) => void
  outputPaths: Record<string, string>
  onOutputPathChange: (mode: string, path: string) => void
}

const modeTooltips: Record<string, string> = {
  mkv_rip: 'Save extracted MKV files to disk via MakeMKV. No re-encoding — preserves original video, audio, and subtitle streams bit-for-bit. Enable alongside other modes to keep the raw MKV copy.',
  raw_capture: 'Full disc backup preserving VIDEO_TS (DVD) or BDMV (Blu-ray) structure, including menus, extras, and all disc metadata. Largest output size.',
  ffv1_archival: 'Re-encode to FFV1 v3 lossless codec with FLAC audio in MKV. Mathematically identical to source — every frame is a keyframe with CRC. Ideal for long-term preservation.',
  streaming_encode: 'Re-encode for streaming using your configured codec (HEVC or H.264). Optimized for Kodi, Plex, and Jellyfin. ~50% smaller than lossless. Surround audio is passed through.',
  kodi_export: 'Full pipeline: extracts from disc, encodes to HEVC/H.264, then organizes into Kodi folder structure with NFO, poster, and fanart. No need to enable MKV Rip separately.'
}

export function RipModesPanel({
  modes,
  onModesChange,
  preserveInterlaced,
  onPreserveInterlacedChange,
  convertSubsToSrt,
  onConvertSubsToSrtChange,
  outputPaths,
  onOutputPathChange
}: RipModesPanelProps) {
  const settings = useAppStore((s) => s.settings)
  const discInfo = useDiscStore((s) => s.discInfo)
  const hasInterlaced = discInfo?.tracks.some((t) => t.isInterlaced) || false
  const kodiIsOn = modes.kodi_export || false

  const modeConfigs = [
    {
      key: 'mkv_rip',
      label: 'MKV Rip',
      description: 'Save extracted MKV to disk — no re-encode',
      pathKey: 'paths.mkv_output'
    },
    {
      key: 'raw_capture',
      label: 'Raw Capture',
      description: 'Full disc backup (VIDEO_TS / BDMV) with menus',
      pathKey: 'paths.raw_output'
    },
    {
      key: 'ffv1_archival',
      label: 'FFV1 Archival',
      description: 'Lossless FFV1 v3 + FLAC — archival quality',
      pathKey: 'paths.ffv1_output'
    },
    {
      key: 'streaming_encode',
      label: 'Streaming Encode',
      description: 'HEVC/H.264 re-encode — Kodi/Plex ready',
      pathKey: 'paths.streaming_output'
    },
    {
      key: 'kodi_export',
      label: 'Capture for Kodi',
      description: 'Rip \u2192 encode \u2192 organize with Kodi-ready NFO, artwork, and folders',
      pathKey: 'kodi.library_path'
    }
  ]

  const toggleMode = (key: string) => {
    onModesChange({ ...modes, [key]: !modes[key] })
  }

  const selectOutputPath = async (mode: string) => {
    const path = await window.ztr.fs.selectDirectory(`Select output for ${mode}`)
    if (path) onOutputPathChange(mode, path)
  }

  return (
    <Card>
      <TechLabel className="mb-3 block">Rip Modes</TechLabel>

      <div className="space-y-3">
        {modeConfigs.map((config) => (
          <div key={config.key}>
            <div className="flex items-center gap-1">
              <Toggle
                checked={modes[config.key] || false}
                onChange={() => toggleMode(config.key)}
                label={config.label}
                description={config.description}
              />
              <Tooltip content={modeTooltips[config.key]} inline position="right" />
            </div>

            {/* Pipeline explanation for Kodi */}
            {config.key === 'kodi_export' && modes.kodi_export && (
              <p className="ml-12 mt-1 text-[10px] text-zinc-500 font-mono">
                Pipeline: Extract (MKV) &rarr; Encode &rarr; Organize (folders + NFO + artwork)
              </p>
            )}

            {modes[config.key] && (
              <div className="ml-12 mt-2 flex items-center gap-2">
                <Input
                  className="flex-1 text-xs"
                  value={outputPaths[config.key] || settings[config.pathKey] || ''}
                  onChange={(e) => onOutputPathChange(config.key, e.target.value)}
                  placeholder="Output path..."
                />
                <Button variant="ghost" size="sm" onClick={() => selectOutputPath(config.key)}>
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Interlace toggle */}
      {hasInterlaced && (
        <div className="mt-4 pt-4 border-t border-zinc-800">
          <div className="flex items-center gap-1">
            <Toggle
              checked={preserveInterlaced}
              onChange={onPreserveInterlacedChange}
              label="Preserve Interlaced Fields"
              description="Skip deinterlacing — encode with interlaced flags for later QTGMC processing"
            />
            <Tooltip
              content="When OFF (default): interlaced content is deinterlaced with yadif for clean progressive playback. When ON: fields are preserved and encoded with interlaced flags (-flags +ilme+ildct), letting you run superior QTGMC deinterlacing via VapourSynth later."
              inline
              position="right"
            />
          </div>
        </div>
      )}

      {/* SRT conversion toggle */}
      {!kodiIsOn && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="flex items-center gap-1">
            <Toggle
              checked={convertSubsToSrt}
              onChange={onConvertSubsToSrtChange}
              label="Convert Subtitles to SRT"
              description="OCR image subs to text SRT — needed for players that can't render PGS/VobSub"
            />
            <Tooltip
              content="DVD subtitles (VobSub) and Blu-ray subtitles (PGS) are bitmap images. This option runs tesseract OCR to convert them to searchable text SRT files. Requires tesseract to be installed. Original image subs are always preserved alongside."
              inline
              position="right"
            />
          </div>
        </div>
      )}
    </Card>
  )
}
