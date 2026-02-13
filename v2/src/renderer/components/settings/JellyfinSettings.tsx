import React from 'react'
import { FolderOpen } from 'lucide-react'
import { Card, Button, TechLabel, LabelWithTooltip } from '../ui'

interface JellyfinSettingsProps {
  settings: Record<string, string>
  onSave: (key: string, value: string) => void
}

export function JellyfinSettings({ settings, onSave }: JellyfinSettingsProps) {
  const selectPath = async () => {
    const path = await window.ztr.fs.selectDirectory('Select Jellyfin library root')
    if (path) onSave('jellyfin.library_path', path)
  }

  return (
    <Card>
      <TechLabel className="mb-4 block">Jellyfin Settings</TechLabel>

      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <LabelWithTooltip
              label="Library Root Path"
              tooltip="The root folder of your Jellyfin media library. Movies will be placed in a Movies/ subfolder with NFO metadata and artwork, following Jellyfin's expected naming conventions (identical to Kodi format)."
              className="label-tech"
            />
            <input
              className="input w-full"
              value={settings['jellyfin.library_path'] || ''}
              onChange={(e) => onSave('jellyfin.library_path', e.target.value)}
              placeholder="/path/to/jellyfin/library"
            />
          </div>
          <Button variant="secondary" onClick={selectPath}>
            <FolderOpen className="w-4 h-4" />
          </Button>
        </div>

        <p className="text-[10px] text-zinc-600 font-mono leading-relaxed">
          Jellyfin reads Kodi-style NFO files and artwork. The TMDB API key from Kodi Settings is shared for metadata lookups.
        </p>
      </div>
    </Card>
  )
}
