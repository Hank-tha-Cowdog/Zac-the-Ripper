import React from 'react'
import { Loader2 } from 'lucide-react'

interface SpinnerProps {
  size?: number
  className?: string
}

export function Spinner({ size = 20, className = '' }: SpinnerProps) {
  return <Loader2 className={`animate-spin-slow text-purple-400 ${className}`} size={size} />
}
