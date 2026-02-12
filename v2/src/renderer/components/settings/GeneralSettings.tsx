import React from 'react'
import { FolderOpen } from 'lucide-react'
import { Card, Input, Button, Toggle, TechLabel, Tooltip, LabelWithTooltip } from '../ui'

interface GeneralSettingsProps {
  settings: Record<string, string>
  onSave: (key: string, value: string) => void
}

const modeTooltips: Record<string, string> = {
  'general.mode_mkv_rip': 'Extract selected titles directly from disc to MKV files via MakeMKV. No re-encoding — preserves original video, audio, and subtitle streams bit-for-bit.',
  'general.mode_raw_capture': 'Full disc backup preserving the complete structure (VIDEO_TS for DVD, BDMV for Blu-ray) including menus, extras, and all metadata. Uses makemkvcon backup.',
  'general.mode_ffv1_archival': 'Re-encode to FFV1 v3 lossless codec with FLAC audio. Mathematically lossless — every frame is a keyframe with CRC verification. Ideal for long-term archival.',
  'general.mode_streaming_encode': 'Re-encode using your configured codec (HEVC or H.264). Optimized for streaming via Kodi, Plex, or Jellyfin. Much smaller files than lossless.',
  'general.mode_kodi_export': 'Create Kodi-compatible folder structure with NFO metadata files, poster/fanart artwork from TMDB, and properly named files. Ready for Kodi library import.'
}

export function GeneralSettings({ settings, onSave }: GeneralSettingsProps) {
  const selectPath = async (key: string) => {
    const path = await window.ztr.fs.selectDirectory('Select default output directory')
    if (path) onSave(key, path)
  }

  const modes = [
    { key: 'general.mode_mkv_rip', label: 'MKV Rip' },
    { key: 'general.mode_raw_capture', label: 'Raw Capture' },
    { key: 'general.mode_ffv1_archival', label: 'FFV1 Archival' },
    { key: 'general.mode_streaming_encode', label: 'Streaming Encode' },
    { key: 'general.mode_kodi_export', label: 'Kodi Export' }
  ]

  return (
    <Card>
      <TechLabel className="mb-4 block">General Settings</TechLabel>

      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <LabelWithTooltip
              label="Default Output Path"
              tooltip="Root directory where all ripped and encoded files will be saved. Each rip mode can override this with its own output path on the Rip page."
              className="label-tech"
            />
            <input
              className="input"
              value={settings['general.default_output_path'] || ''}
              onChange={(e) => onSave('general.default_output_path', e.target.value)}
            />
          </div>
          <Button variant="secondary" onClick={() => selectPath('general.default_output_path')}>
            <FolderOpen className="w-4 h-4" />
          </Button>
        </div>

        <div>
          <LabelWithTooltip
            label="Default Rip Modes"
            tooltip="Choose which rip modes are enabled by default when you start a new rip. You can always toggle individual modes on the Rip page before starting."
            className="label-tech mb-2 block"
          />
          <div className="space-y-2">
            {modes.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-1">
                <Toggle
                  checked={settings[key] === 'true'}
                  onChange={(v) => onSave(key, String(v))}
                  label={label}
                />
                <Tooltip content={modeTooltips[key]} inline position="right" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
