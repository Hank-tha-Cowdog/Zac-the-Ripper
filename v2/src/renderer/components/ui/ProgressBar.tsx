import React from 'react'

type ProgressColor = 'purple' | 'amber' | 'emerald'

interface ProgressBarProps {
  value: number
  color?: ProgressColor
  striped?: boolean
  className?: string
  showLabel?: boolean
}

export function ProgressBar({ value, color = 'purple', striped = false, className = '', showLabel = false }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value))

  return (
    <div className={`${className}`}>
      {showLabel && (
        <div className="flex justify-between mb-1">
          <span className="label-tech">Progress</span>
          <span className="text-xs font-mono text-zinc-400">{clamped.toFixed(1)}%</span>
        </div>
      )}
      <div className="progress-bar">
        <div
          className={`progress-bar-fill progress-bar-fill-${color} ${striped ? 'progress-bar-striped' : ''}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
