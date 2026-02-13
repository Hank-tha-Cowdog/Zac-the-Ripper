import React from 'react'
import { GeneralSettings } from './GeneralSettings'
import { EncodingSettings } from './EncodingSettings'
import { KodiSettings } from './KodiSettings'
import { JellyfinSettings } from './JellyfinSettings'
import { PlexSettings } from './PlexSettings'
import { ToolPathSettings } from './ToolPathSettings'
import { NotificationSettings } from './NotificationSettings'
import { AboutPanel } from './AboutPanel'
import { useSettings } from '../../hooks/useSettings'

export function SettingsPage() {
  const { settings, saveSetting } = useSettings()

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-purple-400">Settings</h1>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-6">
          <GeneralSettings settings={settings} onSave={saveSetting} />
          <NotificationSettings settings={settings} onSave={saveSetting} />
          <ToolPathSettings settings={settings} onSave={saveSetting} />
        </div>
        <div className="space-y-6">
          <EncodingSettings settings={settings} onSave={saveSetting} />
          <JellyfinSettings settings={settings} onSave={saveSetting} />
          <PlexSettings settings={settings} onSave={saveSetting} />
          <KodiSettings settings={settings} onSave={saveSetting} />
          <AboutPanel />
        </div>
      </div>
    </div>
  )
}
