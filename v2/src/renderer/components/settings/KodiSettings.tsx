import React from 'react'
import { FolderOpen } from 'lucide-react'
import { Card, Input, Button, TechLabel, LabelWithTooltip } from '../ui'

interface KodiSettingsProps {
  settings: Record<string, string>
  onSave: (key: string, value: string) => void
}

export function KodiSettings({ settings, onSave }: KodiSettingsProps) {
  const selectPath = async () => {
    const path = await window.ztr.fs.selectDirectory('Select Kodi library root')
    if (path) onSave('kodi.library_path', path)
  }

  return (
    <Card>
      <TechLabel className="mb-4 block">Kodi Settings</TechLabel>

      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <LabelWithTooltip
              label="Library Root Path"
              tooltip="The root folder for Zac the Ripper output. Movies go into Movies/ and TV shows go into TV Shows/. In Kodi, add both subfolders as separate sources — one as 'Movies' and one as 'TV Shows' content type."
              className="label-tech"
            />
            <input
              className="input w-full"
              value={settings['kodi.library_path'] || ''}
              onChange={(e) => onSave('kodi.library_path', e.target.value)}
              placeholder="/path/to/kodi/library"
            />
          </div>
          <Button variant="secondary" onClick={selectPath}>
            <FolderOpen className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <LabelWithTooltip
            label="Naming Convention"
            tooltip="Kodi Standard uses 'Title (Year)' folder naming with .nfo sidecar files. Plex Compatible mode uses the same layout which is also recognized by Plex and Jellyfin."
            className="label-tech"
          />
          <div className="relative">
            <select
              className="select w-full pr-8"
              value={settings['kodi.naming_convention'] || 'kodi_standard'}
              onChange={(e) => onSave('kodi.naming_convention', e.target.value)}
            >
              <option value="kodi_standard">Kodi Standard (Title (Year))</option>
              <option value="plex">Plex Compatible</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <LabelWithTooltip
            label="TMDB API Key"
            tooltip="A free API key from themoviedb.org (TMDB). Used to fetch movie/TV metadata, plot summaries, cast info, poster art, and fanart for your Kodi NFO files. Sign up at tmdb.org to get one."
            className="label-tech"
          />
          <input
            type="password"
            className="input"
            value={settings['kodi.tmdb_api_key'] || ''}
            onChange={(e) => onSave('kodi.tmdb_api_key', e.target.value)}
            placeholder="Enter TMDB v3 API key"
          />
          <span className="text-[10px] text-zinc-600">Free key from themoviedb.org</span>
        </div>
      </div>
    </Card>
  )
}
