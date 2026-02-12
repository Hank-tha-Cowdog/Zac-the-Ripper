import React, { useEffect, useState } from 'react'
import { Card, DataGrid, TechLabel } from '../ui'

export function AboutPanel() {
  const [platform, setPlatform] = useState<{
    platform: string
    arch: string
    electronVersion: string
    nodeVersion: string
    appPath: string
  } | null>(null)

  useEffect(() => {
    window.ztr.app.getPlatform().then(setPlatform)
  }, [])

  return (
    <Card>
      <TechLabel className="mb-4 block">About</TechLabel>

      <div className="space-y-3">
        <div className="text-lg font-bold text-purple-400">Zac the Ripper</div>
        <div className="text-sm text-zinc-400">v2.0.0</div>
        <div className="text-xs text-zinc-600">
          DVD/BD/UHD ripping and encoding suite with Kodi integration
        </div>

        {platform && (
          <DataGrid
            className="mt-4"
            items={[
              { label: 'Platform', value: platform.platform },
              { label: 'Architecture', value: platform.arch },
              { label: 'Electron', value: platform.electronVersion },
              { label: 'Node.js', value: platform.nodeVersion },
              { label: 'Data Path', value: platform.appPath }
            ]}
          />
        )}
      </div>
    </Card>
  )
}
