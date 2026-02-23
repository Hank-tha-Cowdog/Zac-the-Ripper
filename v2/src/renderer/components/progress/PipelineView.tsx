import React from 'react'
import { ArrowRight, Disc3, Cog, FolderOutput } from 'lucide-react'

interface PipelineViewProps {
  activeStage: 'ripping' | 'encoding' | 'export' | null
}

export function PipelineView({ activeStage }: PipelineViewProps) {
  const stages = [
    { key: 'ripping', label: 'Ripping', icon: Disc3 },
    { key: 'encoding', label: 'Encoding', icon: Cog },
    { key: 'export', label: 'Kodi Export', icon: FolderOutput }
  ] as const

  return (
    <div className="flex items-center gap-2 p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg">
      {stages.map((stage, i) => {
        const Icon = stage.icon
        const isActive = activeStage === stage.key
        const isPast = activeStage && stages.findIndex(s => s.key === activeStage) > i

        return (
          <React.Fragment key={stage.key}>
            {i > 0 && <ArrowRight className="w-4 h-4 text-zinc-700 shrink-0" />}
            <div className={`flex items-center gap-2 px-3 py-2 rounded transition-all duration-300 ${
              isActive ? 'bg-purple-600/20 border border-purple-500/30 animate-border-glow' :
              isPast ? 'bg-emerald-500/10 border border-emerald-500/20' :
              'bg-zinc-900 border border-zinc-800'
            }`}>
              <Icon className={`w-4 h-4 ${
                isActive ? 'text-purple-400 animate-spin-slow' :
                isPast ? 'text-emerald-500' :
                'text-zinc-600'
              }`} />
              <span className={`text-xs font-medium ${
                isActive ? 'text-purple-400' :
                isPast ? 'text-emerald-400' :
                'text-zinc-600'
              }`}>
                {stage.label}
              </span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}
