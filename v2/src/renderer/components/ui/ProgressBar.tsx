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
  // Defense in depth: an invalid/missing percentage should read as "no
  // progress yet," not render the literal text "NaN%" (Math.min/max
  // propagate NaN straight through, and NaN.toFixed(1) is the string "NaN").
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0

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
