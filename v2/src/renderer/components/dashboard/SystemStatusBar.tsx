import React, { useEffect } from 'react'
import { CheckCircle, XCircle, HardDrive } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { TechLabel, Tooltip } from '../ui'

export function SystemStatusBar() {
  const { toolStatuses, setToolStatuses, diskSpace, setDiskSpace } = useAppStore()

  useEffect(() => {
    loadStatus()
  }, [])

  const loadStatus = async () => {
    try {
      const tools = await window.ztr.tools.check()
      setToolStatuses(tools)
    } catch {
      // Tools might not be available
    }

    try {
      const settings = await window.ztr.settings.getAll()
      const outputPath = settings['general.default_output_path']
      if (outputPath) {
        const space = await window.ztr.fs.getDiskSpace(outputPath)
        if (!('error' in space)) {
          setDiskSpace(space)
        }
      }
    } catch {
      // Disk space might not be readable
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
  }

  const toolTooltips: Record<string, string> = {
    makemkvcon: 'MakeMKV — required for ripping discs. Download from makemkv.com or configure path in Settings > Tool Paths.',
    ffmpeg: 'FFmpeg — required for encoding (FFV1, HEVC, H.264). Bundled with the app, or install via Homebrew: brew install ffmpeg',
    ffprobe: 'FFprobe — required for media analysis. Bundled with the app, or installed with FFmpeg.',
    mpv: 'mpv — optional, enables disc preview with full playback controls. Install via Homebrew: brew install mpv',
    ffplay: 'ffplay — optional fallback for disc preview (bundled with FFmpeg). Install via Homebrew: brew install ffmpeg',
    lsdvd: 'lsdvd — optional, provides fallback DVD scanning when MakeMKV hangs on certain discs. Install via Homebrew: brew install lsdvd',
    cdparanoia: 'cdparanoia — required for audio CD ripping. Not bundled — install via Homebrew: brew install cdparanoia'
  }

  return (
    <div className="flex items-center gap-6 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
      <TechLabel>System Status</TechLabel>

      {toolStatuses.map((tool) => (
        <Tooltip key={tool.name} content={
          tool.available
            ? `${tool.name} is installed${tool.version ? ` (v${tool.version})` : ''}. Ready to use.`
            : `${tool.name} is NOT found. ${toolTooltips[tool.name] || 'Check Settings > Tool Paths.'}`
        }>
          <div className="flex items-center gap-2 cursor-default">
            {tool.available ? (
              <CheckCircle className="w-3 h-3 text-emerald-500 drop-shadow-[0_0_3px_rgb(16_185_129/0.5)]" />
            ) : (
              <XCircle className="w-3 h-3 text-red-500" />
            )}
            <span className="text-[10px] font-mono text-zinc-400">
              {tool.name}
              {tool.version && <span className="text-zinc-600 ml-1">v{tool.version}</span>}
            </span>
          </div>
        </Tooltip>
      ))}

      {diskSpace && (
        <Tooltip content={`Output drive: ${formatBytes(diskSpace.available)} available of ${formatBytes(diskSpace.total)} total. A typical DVD rip is 4-8 GB, Blu-ray 20-40 GB, UHD 50-100 GB.`}>
          <div className="flex items-center gap-2 ml-auto cursor-default">
            <HardDrive className="w-3 h-3 text-zinc-500" />
            <span className="text-[10px] font-mono text-zinc-400">
              {formatBytes(diskSpace.available)} free / {formatBytes(diskSpace.total)}
            </span>
          </div>
        </Tooltip>
      )}
    </div>
  )
}
