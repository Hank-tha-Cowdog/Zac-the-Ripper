import React from 'react'
import { FolderOpen } from 'lucide-react'
import { Card, Button, TechLabel, LabelWithTooltip } from '../ui'

interface PlexSettingsProps {
  settings: Record<string, string>
  onSave: (key: string, value: string) => void
}

export function PlexSettings({ settings, onSave }: PlexSettingsProps) {
  const selectPath = async () => {
    const path = await window.ztr.fs.selectDirectory('Select Plex library root')
    if (path) onSave('plex.library_path', path)
  }

  return (
    <Card>
      <TechLabel className="mb-4 block">Plex Settings</TechLabel>

      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <LabelWithTooltip
              label="Library Root Path"
              tooltip="The root folder of your Plex media library. Movies will be placed in a Movies/ subfolder with NFO metadata and artwork. Plex uses the same folder structure and naming conventions as Kodi and Jellyfin."
              className="label-tech"
            />
            <input
              className="input w-full"
              value={settings['plex.library_path'] || ''}
              onChange={(e) => onSave('plex.library_path', e.target.value)}
              placeholder="/path/to/plex/library"
            />
          </div>
          <Button variant="secondary" onClick={selectPath}>
            <FolderOpen className="w-4 h-4" />
          </Button>
        </div>

        <p className="text-[10px] text-zinc-600 font-mono leading-relaxed">
          Plex reads Kodi-style NFO files and artwork. The TMDB API key from Kodi Settings is shared for metadata lookups.
        </p>
      </div>
    </Card>
  )
}
