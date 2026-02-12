import React from 'react'

type StatusDotVariant = 'pending' | 'processing' | 'ready' | 'failed'

interface StatusDotProps {
  status: StatusDotVariant
  className?: string
}

const statusClasses: Record<StatusDotVariant, string> = {
  pending: 'status-dot status-dot-pending',
  processing: 'status-dot status-dot-processing',
  ready: 'status-dot status-dot-ready',
  failed: 'status-dot status-dot-failed'
}

export function StatusDot({ status, className = '' }: StatusDotProps) {
  return <span className={`${statusClasses[status]} ${className}`} />
}
