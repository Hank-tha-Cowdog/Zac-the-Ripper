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
              tooltip="The root folder for Zac the Ripper output. Movies go into a Movies/ subfolder and TV shows go into a TV Shows/ subfolder. You need TWO Plex libraries: one 'Movies' type pointed at the Movies/ subfolder, and one 'TV Shows' type pointed at the TV Shows/ subfolder."
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

        <div className="text-[10px] text-zinc-600 font-mono leading-relaxed space-y-1">
          <p>Zac the Ripper creates two subfolders inside this path:</p>
          <p className="text-zinc-500 ml-2">Movies/ &mdash; for movie rips (Plex library type: <span className="text-amber-500">Movies</span>)</p>
          <p className="text-zinc-500 ml-2">TV Shows/ &mdash; for TV series (Plex library type: <span className="text-amber-500">TV Shows</span>)</p>
          <p className="text-amber-500/70 mt-1">You must create two separate libraries in Plex &mdash; one for each subfolder.</p>
        </div>
      </div>
    </Card>
  )
}
