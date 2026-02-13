import React from 'react'
import { FolderOpen } from 'lucide-react'
import { Card, Toggle, Button, TechLabel, Input, Tooltip } from '../ui'
import { useAppStore } from '../../stores/app-store'

interface RipModesPanelProps {
  modes: Record<string, boolean>
  onModesChange: (modes: Record<string, boolean>) => void
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
  kodi_export: 'Full pipeline: extracts from disc, encodes to HEVC/H.264, then organizes into Kodi folder structure with NFO, poster, and fanart. No need to enable MKV Rip separately.',
  jellyfin_export: 'Full pipeline: extracts from disc, encodes to HEVC/H.264, then organizes into Jellyfin folder structure with NFO, poster, and fanart. Identical format to Kodi — compatible with both.',
  plex_export: 'Full pipeline: extracts from disc, encodes to HEVC/H.264, then organizes into Plex folder structure with NFO, poster, and fanart. Identical format to Kodi/Jellyfin — compatible with all three.'
}

export function RipModesPanel({
  modes,
  onModesChange,
  convertSubsToSrt,
  onConvertSubsToSrtChange,
  outputPaths,
  onOutputPathChange
}: RipModesPanelProps) {
  const settings = useAppStore((s) => s.settings)
  const mediaLibIsOn = modes.kodi_export || modes.jellyfin_export || modes.plex_export || false

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
      key: 'jellyfin_export',
      label: 'Capture for Jellyfin',
      description: 'Rip \u2192 encode \u2192 organize with Jellyfin-ready NFO, artwork, and folders',
      pathKey: 'jellyfin.library_path'
    },
    {
      key: 'plex_export',
      label: 'Capture for Plex',
      description: 'Rip \u2192 encode \u2192 organize with Plex-ready NFO, artwork, and folders',
      pathKey: 'plex.library_path'
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

            {/* Pipeline explanation for media library modes */}
            {(config.key === 'jellyfin_export' || config.key === 'plex_export' || config.key === 'kodi_export') && modes[config.key] && (
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

      {/* SRT conversion toggle */}
      {!mediaLibIsOn && (
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
