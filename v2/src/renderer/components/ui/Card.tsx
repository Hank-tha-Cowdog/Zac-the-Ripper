import React from 'react'

interface CardProps {
  variant?: 'default' | 'solid'
  className?: string
  children: React.ReactNode
  padding?: boolean
}

export function Card({ variant = 'default', className = '', children, padding = true }: CardProps) {
  const base = variant === 'solid' ? 'card-solid' : 'card'
  return (
    <div className={`${base} ${padding ? 'p-4' : ''} ${className}`}>
      {children}
    </div>
  )
}
