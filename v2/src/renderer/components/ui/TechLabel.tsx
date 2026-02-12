import React from 'react'

interface TechLabelProps {
  children: React.ReactNode
  className?: string
}

export function TechLabel({ children, className = '' }: TechLabelProps) {
  return <span className={`label-tech ${className}`}>{children}</span>
}
