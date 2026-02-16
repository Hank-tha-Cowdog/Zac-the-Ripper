import React from 'react'
import { FolderOpen, Music } from 'lucide-react'
import { Card, Button, TechLabel, Toggle, LabelWithTooltip } from '../ui'

interface AudioSettingsProps {
  settings: Record<string, string>
  onSave: (key: string, value: string) => void
}

export function AudioSettings({ settings, onSave }: AudioSettingsProps) {
  const selectPath = async () => {
    const path = await window.ztr.fs.selectDirectory('Select Music Library Folder')
    if (path) onSave('paths.music_output', path)
  }

  return (
    <Card>
      <TechLabel className="mb-4 block">
        <Music className="w-4 h-4 inline mr-1.5" />
        Audio CD / Navidrome
      </TechLabel>

      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <LabelWithTooltip
              label="Music Library Path"
              tooltip="Root folder for ripped music files. Output structure: Artist/Album (Year)/01 - Track.flac. Compatible with Navidrome, Jellyfin, Plex, and any folder-based music server."
              className="label-tech"
            />
            <input
              className="input w-full"
              value={settings['paths.music_output'] || ''}
              onChange={(e) => onSave('paths.music_output', e.target.value)}
              placeholder="~/Music/Zac the Ripper"
            />
          </div>
          <Button variant="secondary" onClick={selectPath}>
            <FolderOpen className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <LabelWithTooltip
            label="MusicBrainz Auto-Lookup"
            tooltip="Automatically look up disc metadata from MusicBrainz when an audio CD is inserted. Populates artist, album, year, and track titles."
            className="label-tech"
          />
          <Toggle
            checked={settings['audio.musicbrainz_auto_lookup'] !== 'false'}
            onChange={(v) => onSave('audio.musicbrainz_auto_lookup', v ? 'true' : 'false')}
          />
        </div>

        <div className="flex items-center justify-between">
          <LabelWithTooltip
            label="Embed Cover Art"
            tooltip="Embed album cover art from MusicBrainz/Cover Art Archive directly into each FLAC file as an attached picture. Also saved as folder.jpg."
            className="label-tech"
          />
          <Toggle
            checked={settings['audio.embed_cover_art'] !== 'false'}
            onChange={(v) => onSave('audio.embed_cover_art', v ? 'true' : 'false')}
          />
        </div>

        <div>
          <LabelWithTooltip
            label="FLAC Compression Level"
            tooltip="FLAC compression level (0-8). Higher = smaller files but slower encoding. Level 8 is recommended — encoding is still fast since FLAC is lossless. All levels produce identical audio quality."
            className="label-tech"
          />
          <select
            className="input w-full mt-1"
            value={settings['audio.flac_compression'] || '8'}
            onChange={(e) => onSave('audio.flac_compression', e.target.value)}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(level => (
              <option key={level} value={String(level)}>
                {level}{level === 0 ? ' (fastest, largest)' : level === 5 ? ' (default)' : level === 8 ? ' (smallest, recommended)' : ''}
              </option>
            ))}
          </select>
        </div>

        <p className="text-[10px] text-zinc-600 font-mono leading-relaxed">
          Audio CDs are ripped to FLAC (lossless) via cdparanoia. Navidrome handles on-the-fly transcoding for remote streaming.
        </p>
      </div>
    </Card>
  )
}
