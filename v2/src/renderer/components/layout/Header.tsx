import React from 'react'
import { HardDrive } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'

export function Header() {
  const diskSpace = useAppStore((s) => s.diskSpace)

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
  }

  return (
    <header className="h-10 bg-zinc-900/80 border-b border-zinc-800 flex items-center px-4 justify-between drag-region shrink-0">
      {/* macOS traffic light spacer */}
      <div className="w-16" />

      <div className="flex items-center gap-4 no-drag">
        {diskSpace && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <HardDrive className="w-3 h-3" />
            <span className="font-mono">{formatBytes(diskSpace.available)} free</span>
          </div>
        )}
      </div>
    </header>
  )
}
